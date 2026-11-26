import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { logger } from '../../common/logger';
import { PrismaService } from '../../common/prisma.service';
import { UserPrincipal } from '../../common/principal';
import { AuthService } from '../auth/auth.service';
import { BillingService } from '../billing/billing.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { StalwartClient } from '../stalwart/stalwart.client';

const ORG_SUSPENSION = '[organisation suspended]';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stalwart: StalwartClient,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
    private readonly monitoring: MonitoringService,
    private readonly orgs: OrganizationsService,
    private readonly auth: AuthService,
  ) {}

  async overview() {
    const day = new Date(Date.now() - 86400_000);
    const [orgs, users, domains, mbTotal, mbActive, mbSuspended, storage, events24h, alerts, recent, components, system] = await Promise.all([
      this.prisma.organization.groupBy({ by: ['status'], where: { deletedAt: null }, _count: true }),
      this.prisma.user.count(),
      this.prisma.domain.groupBy({ by: ['status'], _count: true }),
      this.prisma.mailbox.count({ where: { status: { not: 'DELETED' } } }),
      this.prisma.mailbox.count({ where: { status: 'ACTIVE' } }),
      this.prisma.mailbox.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.mailbox.aggregate({ where: { status: { not: 'DELETED' } }, _sum: { usedBytes: true, quotaMb: true } }),
      this.prisma.deliveryEvent.groupBy({ by: ['category'], where: { occurredAt: { gte: day } }, _count: true }),
      this.prisma.securityEvent.findMany({ where: { resolvedAt: null, severity: { in: ['WARNING', 'CRITICAL'] } }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 12, include: { actor: { select: { email: true, name: true } }, organization: { select: { name: true } } } }),
      this.monitoring.components(),
      this.monitoring.system(),
    ]);
    let queue: { total: number } | { error: string };
    try {
      queue = { total: (await this.stalwart.queueSummary(1)).total };
    } catch (e) {
      queue = { error: (e as Error).message };
    }
    const cat = (c: string) => events24h.find((e) => e.category === c)?._count ?? 0;
    return {
      organizations: { total: orgs.reduce((s, o) => s + o._count, 0), byStatus: Object.fromEntries(orgs.map((o) => [o.status, o._count])) },
      users,
      domains: { total: domains.reduce((s, d) => s + d._count, 0), byStatus: Object.fromEntries(domains.map((d) => [d.status, d._count])) },
      mailboxes: { total: mbTotal, active: mbActive, suspended: mbSuspended },
      storage: { usedBytes: Number(storage._sum.usedBytes ?? 0), allocatedMb: storage._sum.quotaMb ?? 0 },
      mail24h: { incoming: cat('ham') + cat('spam'), outgoing: cat('queued_outbound'), delivered: cat('delivered'), failed: cat('failed') + cat('bounce'), deferred: cat('temp_fail'), spam: cat('spam'), authFailures: cat('auth_failed') },
      queue,
      components,
      system,
      alerts,
      recentActivity: recent,
    };
  }

  async listOrgs(opts: { page: number; pageSize: number; q?: string; status?: string }) {
    const where: Prisma.OrganizationWhereInput = {
      deletedAt: null,
      ...(opts.status ? { status: opts.status as any } : {}),
      ...(opts.q ? { OR: [{ name: { contains: opts.q, mode: 'insensitive' } }, { slug: { contains: opts.q } }, { domains: { some: { name: { contains: opts.q } } } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.organization.count({ where }),
      this.prisma.organization.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include: {
          subscription: { include: { plan: { select: { name: true, code: true } } } },
          _count: { select: { domains: true, mailboxes: { where: { status: { not: 'DELETED' } } }, memberships: true } },
        },
      }),
    ]);
    return { total, page: opts.page, pageSize: opts.pageSize, items: rows };
  }

  async orgDetail(id: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
      include: {
        subscription: { include: { plan: true } },
        domains: { orderBy: { createdAt: 'asc' } },
        memberships: { include: { user: { select: { id: true, email: true, name: true, status: true, authSource: true } } } },
      },
    });
    if (!org) throw new NotFoundException('Organisation not found');
    const usage = await this.orgs.usage(id);
    return { ...org, usage };
  }

  /** Creates an organisation and invites its first owner by email. */
  async createOrg(p: UserPrincipal, input: { name: string; ownerEmail: string; planCode?: string }, ip?: string) {
    const org = await this.prisma.$transaction(async (tx) => {
      const o = await tx.organization.create({ data: { name: input.name, slug: await this.auth.uniqueSlug(tx, input.name) } });
      await this.billing.startTrial(tx, o.id, input.planCode ?? 'starter');
      return o;
    });
    const existing = await this.prisma.user.findUnique({ where: { email: input.ownerEmail } });
    let invitation: unknown = null;
    if (existing && existing.authSource === 'LOCAL') {
      await this.prisma.membership.create({ data: { userId: existing.id, organizationId: org.id, role: 'OWNER' } });
    } else {
      invitation = await this.orgs.invite(p, { orgContext: { organizationId: org.id, role: 'SUPER_ADMIN' }, ip } as any, org.id, input.ownerEmail, 'OWNER');
    }
    await this.audit.record(p, { action: 'admin.organization_created', organizationId: org.id, targetType: 'organization', targetId: org.id, metadata: { ownerEmail: input.ownerEmail }, ip });
    return { organization: org, invitation };
  }

  async updateOrg(p: UserPrincipal, id: string, patch: { name?: string; maxMailboxesOverride?: number | null; maxDomainsOverride?: number | null; maxStorageMbOverride?: number | null; sendLimitPerHourOverride?: number | null }, ip?: string) {
    const org = await this.prisma.organization.update({ where: { id }, data: patch });
    await this.audit.record(p, { action: 'admin.organization_updated', organizationId: id, targetType: 'organization', targetId: id, metadata: patch, ip });
    return org;
  }

  /** Suspends the organisation and every active mailbox on the mail server (mail stops flowing). */
  async suspendOrg(p: UserPrincipal, id: string, reason: string, ip?: string) {
    const org = await this.prisma.organization.findFirst({ where: { id, deletedAt: null } });
    if (!org) throw new NotFoundException('Organisation not found');
    const mbs = await this.prisma.mailbox.findMany({ where: { organizationId: id, status: 'ACTIVE', stalwartId: { not: null } } });
    const failures: string[] = [];
    for (const m of mbs) {
      try {
        await this.stalwart.suspendAccount(m.stalwartId!);
        await this.prisma.mailbox.update({ where: { id: m.id }, data: { status: 'SUSPENDED', suspendedReason: ORG_SUSPENSION } });
      } catch (e) {
        failures.push(`${m.address}: ${(e as Error).message}`);
      }
    }
    await this.prisma.organization.update({ where: { id }, data: { status: 'SUSPENDED', suspendedReason: reason } });
    await this.prisma.user.updateMany({ where: { authSource: 'MAILBOX', memberships: { some: { organizationId: id } } }, data: { status: 'SUSPENDED' } });
    await this.audit.record(p, { action: 'admin.organization_suspended', organizationId: id, targetType: 'organization', targetId: id, metadata: { reason, mailboxes: mbs.length, failures }, ip });
    return { ok: failures.length === 0, suspendedMailboxes: mbs.length - failures.length, failures };
  }

  async reactivateOrg(p: UserPrincipal, id: string, ip?: string) {
    const mbs = await this.prisma.mailbox.findMany({ where: { organizationId: id, status: 'SUSPENDED', suspendedReason: ORG_SUSPENSION } });
    const failures: string[] = [];
    for (const m of mbs) {
      try {
        if (m.stalwartId) await this.stalwart.reactivateAccount(m.stalwartId);
        await this.prisma.mailbox.update({ where: { id: m.id }, data: { status: 'ACTIVE', suspendedReason: null } });
      } catch (e) {
        failures.push(`${m.address}: ${(e as Error).message}`);
      }
    }
    await this.prisma.organization.update({ where: { id }, data: { status: 'ACTIVE', suspendedReason: null } });
    await this.prisma.user.updateMany({
      where: { authSource: 'MAILBOX', memberships: { some: { organizationId: id } }, email: { in: (await this.prisma.mailbox.findMany({ where: { organizationId: id, status: 'ACTIVE' }, select: { address: true } })).map((m) => m.address) } },
      data: { status: 'ACTIVE' },
    });
    await this.audit.record(p, { action: 'admin.organization_reactivated', organizationId: id, targetType: 'organization', targetId: id, metadata: { failures }, ip });
    return { ok: failures.length === 0, reactivatedMailboxes: mbs.length - failures.length, failures };
  }

  /**
   * Deletes an organisation. Safeguards: it must be suspended first and the exact name typed.
   * Mailboxes and domains are removed from the mail server before the database rows.
   */
  async deleteOrg(p: UserPrincipal, id: string, confirmName: string, ip?: string) {
    const org = await this.prisma.organization.findFirst({ where: { id, deletedAt: null } });
    if (!org) throw new NotFoundException('Organisation not found');
    if (org.status !== 'SUSPENDED') throw new BadRequestException('Suspend the organisation before deleting it');
    if (confirmName !== org.name) throw new BadRequestException('Type the organisation name exactly to confirm');
    const mbs = await this.prisma.mailbox.findMany({ where: { organizationId: id } });
    for (const m of mbs) {
      if (m.stalwartId) await this.stalwart.destroyAccount(m.stalwartId).catch((e) => logger.warn({ err: (e as Error).message }, 'destroyAccount'));
    }
    const domains = await this.prisma.domain.findMany({ where: { organizationId: id } });
    for (const d of domains) {
      if (d.stalwartId) await this.stalwart.destroyDomain(d.stalwartId).catch((e) => logger.warn({ err: (e as Error).message }, 'destroyDomain'));
    }
    await this.audit.record(p, { action: 'admin.organization_deleted', targetType: 'organization', targetId: id, metadata: { name: org.name, mailboxes: mbs.length, domains: domains.length }, ip });
    await this.prisma.$transaction(async (tx) => {
      await tx.user.deleteMany({ where: { authSource: 'MAILBOX', email: { in: mbs.map((m) => m.address) } } });
      await tx.mailbox.deleteMany({ where: { organizationId: id } });
      await tx.organization.delete({ where: { id } });
    });
    return { ok: true };
  }

  async listUsers(opts: { page: number; pageSize: number; q?: string }) {
    const where: Prisma.UserWhereInput = opts.q ? { OR: [{ email: { contains: opts.q, mode: 'insensitive' } }, { name: { contains: opts.q, mode: 'insensitive' } }] } : {};
    const [total, items] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        select: {
          id: true, email: true, name: true, platformRole: true, status: true, authSource: true, emailVerifiedAt: true, totpEnabledAt: true, lastLoginAt: true, createdAt: true,
          memberships: { select: { role: true, organization: { select: { id: true, name: true } } } },
        },
      }),
    ]);
    return { total, page: opts.page, pageSize: opts.pageSize, items };
  }

  async setUserStatus(p: UserPrincipal, id: string, suspended: boolean, reason?: string, ip?: string) {
    if (id === p.userId) throw new BadRequestException('You cannot suspend yourself');
    const u = await this.prisma.user.update({ where: { id }, data: { status: suspended ? 'SUSPENDED' : 'ACTIVE', suspendedReason: suspended ? (reason ?? null) : null } });
    if (suspended) await this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record(p, { action: suspended ? 'admin.user_suspended' : 'admin.user_reactivated', targetType: 'user', targetId: id, metadata: { reason }, ip });
    return { id: u.id, status: u.status };
  }

  async setPlatformRole(p: UserPrincipal, id: string, role: 'SUPER_ADMIN' | 'USER', ip?: string) {
    if (id === p.userId && role !== 'SUPER_ADMIN') throw new BadRequestException('You cannot remove your own super admin role');
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    if (u.authSource !== 'LOCAL') throw new BadRequestException('Mailbox accounts cannot be platform administrators');
    if (role === 'SUPER_ADMIN' && !u.totpEnabledAt) throw new BadRequestException('The user must enable two-factor authentication first');
    await this.prisma.user.update({ where: { id }, data: { platformRole: role } });
    await this.audit.record(p, { action: 'admin.platform_role_changed', targetType: 'user', targetId: id, metadata: { role }, ip });
    return { ok: true };
  }
}
