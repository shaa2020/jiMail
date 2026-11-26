import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OrgRole, Prisma } from '@prisma/client';
import { loadConfig } from '../../config/config';
import { AuditService } from '../../common/audit.service';
import { hashToken, randomToken } from '../../common/crypto';
import { MailerService } from '../../common/mailer.service';
import { PrismaService } from '../../common/prisma.service';
import { JiRequest, ORG_ROLE_RANK, Principal, UserPrincipal } from '../../common/principal';
import { AuthService } from '../auth/auth.service';
import { BillingService } from '../billing/billing.service';

@Injectable()
export class OrganizationsService {
  private readonly cfg = loadConfig();
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mailer: MailerService,
    private readonly billing: BillingService,
    private readonly auth: AuthService,
  ) {}

  async mine(p: UserPrincipal) {
    const ms = await this.prisma.membership.findMany({
      where: { userId: p.userId, organization: { deletedAt: null } },
      include: { organization: { select: { id: true, name: true, slug: true, status: true, require2fa: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return ms.map((m) => ({ ...m.organization, role: m.role }));
  }

  async create(p: UserPrincipal, name: string, ip?: string) {
    const owned = await this.prisma.membership.count({ where: { userId: p.userId, role: 'OWNER' } });
    if (owned >= 10 && p.platformRole !== 'SUPER_ADMIN') throw new ForbiddenException('You can own at most 10 organisations');
    const org = await this.prisma.$transaction(async (tx) => {
      const o = await tx.organization.create({ data: { name, slug: await this.auth.uniqueSlug(tx, name) } });
      await tx.membership.create({ data: { userId: p.userId, organizationId: o.id, role: 'OWNER' } });
      await this.billing.startTrial(tx, o.id);
      return o;
    });
    await this.audit.record(p, { action: 'organization.created', organizationId: org.id, targetType: 'organization', targetId: org.id, ip });
    return org;
  }

  async get(orgId: string) {
    return this.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, include: { subscription: { include: { plan: true } } } });
  }

  async update(p: Principal, req: JiRequest, orgId: string, patch: { name?: string; require2fa?: boolean }) {
    if (patch.require2fa !== undefined && !['OWNER', 'SUPER_ADMIN'].includes(String(req.orgContext?.role))) {
      throw new ForbiddenException('Only the owner can change the two-factor policy');
    }
    const o = await this.prisma.organization.update({ where: { id: orgId }, data: patch });
    await this.audit.record(p, { action: 'organization.updated', organizationId: orgId, targetType: 'organization', targetId: orgId, metadata: patch, ip: req.ip });
    return o;
  }

  async dashboard(orgId: string) {
    const since = new Date(Date.now() - 30 * 86400_000);
    const [org, domains, mbAgg, activeMb, suspendedMb, events, recent, limits] = await Promise.all([
      this.get(orgId),
      this.prisma.domain.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, status: true, mailReadyAt: true, lastCheckedAt: true } }),
      this.prisma.mailbox.aggregate({ where: { organizationId: orgId, status: { not: 'DELETED' } }, _count: true, _sum: { usedBytes: true, quotaMb: true } }),
      this.prisma.mailbox.count({ where: { organizationId: orgId, status: 'ACTIVE' } }),
      this.prisma.mailbox.count({ where: { organizationId: orgId, status: 'SUSPENDED' } }),
      this.prisma.deliveryEvent.groupBy({ by: ['category'], where: { organizationId: orgId, occurredAt: { gte: since } }, _count: true }),
      this.prisma.auditLog.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 10, include: { actor: { select: { name: true, email: true } } } }),
      this.billing.limits(orgId),
    ]);
    const count = (c: string) => events.find((e) => e.category === c)?._count ?? 0;
    return {
      organization: { id: org.id, name: org.name, status: org.status, createdAt: org.createdAt, require2fa: org.require2fa },
      subscription: org.subscription ? { status: org.subscription.status, plan: org.subscription.plan.name, trialEndsAt: org.subscription.trialEndsAt, currentPeriodEnd: org.subscription.currentPeriodEnd } : null,
      limits,
      domains,
      mailboxes: { total: mbAgg._count, active: activeMb, suspended: suspendedMb },
      storage: { usedBytes: Number(mbAgg._sum.usedBytes ?? 0), allocatedMb: mbAgg._sum.quotaMb ?? 0 },
      mail30d: { sent: count('queued_outbound'), delivered: count('delivered'), failed: count('failed') + count('bounce'), received: count('ham') + count('spam'), spam: count('spam') },
      recentActivity: recent,
    };
  }

  // ───────────── Members ─────────────

  members(orgId: string) {
    return this.prisma.membership.findMany({
      where: { organizationId: orgId },
      include: { user: { select: { id: true, email: true, name: true, status: true, authSource: true, totpEnabledAt: true, lastLoginAt: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  private assertCanAssign(req: JiRequest, role: OrgRole) {
    const mine = req.orgContext?.role;
    if (mine === 'SUPER_ADMIN') return;
    if (!mine || mine === 'API_KEY') throw new ForbiddenException();
    if (role === 'OWNER' && mine !== 'OWNER') throw new ForbiddenException('Only an owner can grant the owner role');
    if (ORG_ROLE_RANK[role] > ORG_ROLE_RANK[mine]) throw new ForbiddenException('You cannot grant a role higher than your own');
  }

  async changeRole(p: Principal, req: JiRequest, orgId: string, userId: string, role: OrgRole) {
    this.assertCanAssign(req, role);
    const m = await this.prisma.membership.findUnique({ where: { userId_organizationId: { userId, organizationId: orgId } }, include: { user: true } });
    if (!m) throw new NotFoundException('Member not found');
    if (m.role === 'OWNER' && req.orgContext?.role !== 'OWNER' && req.orgContext?.role !== 'SUPER_ADMIN') throw new ForbiddenException('Only an owner can change another owner');
    if (m.user.authSource === 'MAILBOX' && ORG_ROLE_RANK[role] > ORG_ROLE_RANK.MAILBOX_ADMIN) {
      throw new BadRequestException('Mailbox accounts can be at most Mailbox Administrators. Invite a personal account for administration.');
    }
    if (m.role === 'OWNER' && role !== 'OWNER') await this.assertNotLastOwner(orgId, userId);
    const updated = await this.prisma.membership.update({ where: { id: m.id }, data: { role } });
    await this.audit.record(p, { action: 'member.role_changed', organizationId: orgId, targetType: 'user', targetId: userId, metadata: { from: m.role, to: role }, ip: req.ip });
    return updated;
  }

  private async assertNotLastOwner(orgId: string, userId: string) {
    const owners = await this.prisma.membership.count({ where: { organizationId: orgId, role: 'OWNER', userId: { not: userId } } });
    if (!owners) throw new BadRequestException('An organisation needs at least one owner');
  }

  async removeMember(p: Principal, req: JiRequest, orgId: string, userId: string) {
    const m = await this.prisma.membership.findUnique({ where: { userId_organizationId: { userId, organizationId: orgId } }, include: { user: true } });
    if (!m) throw new NotFoundException('Member not found');
    if (m.user.authSource === 'MAILBOX') throw new BadRequestException('Mailbox accounts are removed by deleting the mailbox');
    if (m.role === 'OWNER') {
      if (req.orgContext?.role !== 'OWNER' && req.orgContext?.role !== 'SUPER_ADMIN') throw new ForbiddenException('Only an owner can remove an owner');
      await this.assertNotLastOwner(orgId, userId);
    }
    await this.prisma.$transaction([
      this.prisma.mailboxAccess.deleteMany({ where: { userId, mailbox: { organizationId: orgId } } }),
      this.prisma.membership.delete({ where: { id: m.id } }),
    ]);
    await this.audit.record(p, { action: 'member.removed', organizationId: orgId, targetType: 'user', targetId: userId, ip: req.ip });
    return { ok: true };
  }

  // ───────────── Invitations ─────────────

  invitations(orgId: string) {
    return this.prisma.invitation.findMany({
      where: { organizationId: orgId, status: 'PENDING', expiresAt: { gt: new Date() } },
      select: { id: true, email: true, role: true, createdAt: true, expiresAt: true, invitedBy: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async invite(p: UserPrincipal, req: JiRequest, orgId: string, email: string, role: OrgRole) {
    this.assertCanAssign(req, role);
    const existingMember = await this.prisma.membership.findFirst({ where: { organizationId: orgId, user: { email } } });
    if (existingMember) throw new ConflictException('This person is already a member');
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    const token = randomToken(32);
    await this.prisma.invitation.updateMany({ where: { organizationId: orgId, email, status: 'PENDING' }, data: { status: 'REVOKED' } });
    const inv = await this.prisma.invitation.create({
      data: { organizationId: orgId, email, role, tokenHash: hashToken(token), invitedById: p.userId, expiresAt: new Date(Date.now() + 7 * 86400_000) },
    });
    const sent = await this.mailer.send({
      to: email,
      subject: `${p.name} invited you to ${org.name} on ${this.cfg.APP_NAME}`,
      heading: `Join ${org.name}`,
      paragraphs: [`${p.name} (${p.email}) invited you to help manage ${org.name} as ${role.replace('_', ' ').toLowerCase()}.`, 'The invitation is valid for 7 days.'],
      action: { label: 'Accept invitation', url: `${this.cfg.APP_URL}/invite?token=${encodeURIComponent(token)}` },
    });
    await this.audit.record(p, { action: 'member.invited', organizationId: orgId, targetType: 'invitation', targetId: inv.id, metadata: { email, role }, ip: req.ip });
    return { id: inv.id, email, role, expiresAt: inv.expiresAt, emailSent: sent };
  }

  async revokeInvitation(p: Principal, req: JiRequest, orgId: string, id: string) {
    const r = await this.prisma.invitation.updateMany({ where: { id, organizationId: orgId, status: 'PENDING' }, data: { status: 'REVOKED' } });
    if (!r.count) throw new NotFoundException('Invitation not found');
    await this.audit.record(p, { action: 'member.invitation_revoked', organizationId: orgId, targetType: 'invitation', targetId: id, ip: req.ip });
    return { ok: true };
  }

  async invitationByToken(token: string) {
    const inv = await this.prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) }, include: { organization: { select: { name: true } } } });
    if (!inv || inv.status !== 'PENDING' || inv.expiresAt < new Date()) throw new NotFoundException('This invitation is invalid or has expired');
    const userExists = !!(await this.prisma.user.findUnique({ where: { email: inv.email } }));
    return { email: inv.email, role: inv.role, organizationName: inv.organization.name, userExists, inv };
  }

  async accept(token: string, p: UserPrincipal, ip?: string) {
    const { inv } = await this.invitationByToken(token);
    if (inv.email !== p.email) throw new ForbiddenException(`This invitation was sent to ${inv.email}. Sign in with that account to accept it.`);
    await this.prisma.$transaction(async (tx) => {
      await tx.membership.upsert({
        where: { userId_organizationId: { userId: p.userId, organizationId: inv.organizationId } },
        update: { role: inv.role },
        create: { userId: p.userId, organizationId: inv.organizationId, role: inv.role },
      });
      await tx.invitation.update({ where: { id: inv.id }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
    });
    await this.audit.record(p, { action: 'member.joined', organizationId: inv.organizationId, targetType: 'user', targetId: p.userId, metadata: { role: inv.role }, ip });
    return { organizationId: inv.organizationId };
  }

  /** New account via invitation: the token proves control of the address, so it is pre-verified. */
  async registerWithInvite(token: string, name: string, password: string, ip?: string) {
    const { inv, userExists } = await this.invitationByToken(token);
    if (userExists) throw new ConflictException('An account already exists for this address. Sign in to accept the invitation.');
    const passwordHash = await this.auth.hashPassword(password);
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { email: inv.email, name, passwordHash, emailVerifiedAt: new Date() } });
      await tx.membership.create({ data: { userId: u.id, organizationId: inv.organizationId, role: inv.role } });
      await tx.invitation.update({ where: { id: inv.id }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
      return u;
    });
    await this.audit.record(undefined, { action: 'member.joined', organizationId: inv.organizationId, targetType: 'user', targetId: user.id, metadata: { role: inv.role, via: 'invite_signup' }, ip });
    return { ok: true };
  }

  // ───────────── Logs & stats ─────────────

  async auditLogs(orgId: string | null, opts: { page: number; pageSize: number; q?: string; action?: string }) {
    const where: Prisma.AuditLogWhereInput = {
      ...(orgId ? { organizationId: orgId } : {}),
      ...(opts.action ? { action: { startsWith: opts.action } } : {}),
      ...(opts.q ? { OR: [{ action: { contains: opts.q } }, { targetId: opts.q }, { actor: { email: { contains: opts.q, mode: 'insensitive' } } }] } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include: { actor: { select: { name: true, email: true } }, organization: { select: { name: true } } },
      }),
    ]);
    return { total, page: opts.page, pageSize: opts.pageSize, items };
  }

  async deliveryStats(orgId: string | null, days: number) {
    const since = new Date(Date.now() - days * 86400_000);
    const where: Prisma.DeliveryEventWhereInput = { occurredAt: { gte: since }, ...(orgId ? { organizationId: orgId } : {}) };
    const [byCategory, recentFailures, rows] = await Promise.all([
      this.prisma.deliveryEvent.groupBy({ by: ['category'], where, _count: true }),
      this.prisma.deliveryEvent.findMany({
        where: { ...where, category: { in: ['failed', 'bounce', 'temp_fail'] } },
        orderBy: { occurredAt: 'desc' },
        take: 50,
        select: { id: true, type: true, category: true, sender: true, recipient: true, detail: true, occurredAt: true },
      }),
      this.prisma.$queryRaw<{ day: Date; category: string; n: bigint }[]>`
        SELECT date_trunc('day', "occurredAt") AS day, category, count(*)::bigint AS n
        FROM "DeliveryEvent"
        WHERE "occurredAt" >= ${since} AND (${orgId}::text IS NULL OR "organizationId" = ${orgId})
        GROUP BY 1, 2 ORDER BY 1`,
    ]);
    const series: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      const d = r.day.toISOString().slice(0, 10);
      series[d] ??= {};
      series[d][r.category] = Number(r.n);
    }
    const days_: { date: string; [k: string]: number | string }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
      days_.push({ date: d, ...(series[d] ?? {}) });
    }
    return { totals: Object.fromEntries(byCategory.map((c) => [c.category, c._count])), series: days_, recentFailures };
  }

  async usage(orgId: string) {
    const [limits, agg, domains, history] = await Promise.all([
      this.billing.limits(orgId),
      this.prisma.mailbox.aggregate({ where: { organizationId: orgId, status: { not: 'DELETED' } }, _count: true, _sum: { usedBytes: true, quotaMb: true } }),
      this.prisma.domain.count({ where: { organizationId: orgId } }),
      this.prisma.usageSnapshot.findMany({ where: { organizationId: orgId }, orderBy: { takenAt: 'desc' }, take: 30 }),
    ]);
    const top = await this.prisma.mailbox.findMany({ where: { organizationId: orgId, status: { not: 'DELETED' } }, orderBy: { usedBytes: 'desc' }, take: 10, select: { id: true, address: true, usedBytes: true, quotaMb: true } });
    return {
      limits,
      mailboxes: agg._count,
      domains,
      storage: { usedBytes: Number(agg._sum.usedBytes ?? 0), allocatedMb: agg._sum.quotaMb ?? 0 },
      topMailboxes: top.map((t) => ({ ...t, usedBytes: Number(t.usedBytes) })),
      history: history.reverse().map((h) => ({ takenAt: h.takenAt, mailboxes: h.mailboxes, domains: h.domains, storageBytes: Number(h.storageBytes) })),
    };
  }
}
