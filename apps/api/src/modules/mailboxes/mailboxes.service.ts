import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Mailbox, Prisma } from '@prisma/client';
import Papa from 'papaparse';
import { z } from 'zod';
import { loadConfig } from '../../config/config';
import { AuditService } from '../../common/audit.service';
import { encrypt, generatePassword } from '../../common/crypto';
import { logger } from '../../common/logger';
import { PrismaService } from '../../common/prisma.service';
import { Principal } from '../../common/principal';
import { zLocalPart, zPassword } from '../../common/zod';
import { BillingService } from '../billing/billing.service';
import { StalwartClient } from '../stalwart/stalwart.client';

const MB = 1024 * 1024;

export interface CreateMailboxInput {
  domainId: string;
  localPart: string;
  displayName: string;
  password?: string;
  generatePassword?: boolean;
  quotaMb?: number;
}

const publicFields = {
  id: true,
  organizationId: true,
  domainId: true,
  localPart: true,
  address: true,
  displayName: true,
  status: true,
  quotaMb: true,
  usedBytes: true,
  usageSyncedAt: true,
  sendLimitPerHour: true,
  forwardTo: true,
  forwardKeepCopy: true,
  suspendedReason: true,
  createdAt: true,
  updatedAt: true,
  aliases: { select: { id: true, address: true, localPart: true, domainId: true, createdAt: true } },
} satisfies Prisma.MailboxSelect;

export type PublicMailbox = Prisma.MailboxGetPayload<{ select: typeof publicFields }>;

export function serializeMailbox(m: PublicMailbox) {
  return { ...m, usedBytes: Number(m.usedBytes) };
}

@Injectable()
export class MailboxesService {
  private readonly cfg = loadConfig();
  constructor(
    private readonly prisma: PrismaService,
    private readonly stalwart: StalwartClient,
    private readonly billing: BillingService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, opts: { page: number; pageSize: number; q?: string; domainId?: string; status?: string }) {
    const where: Prisma.MailboxWhereInput = {
      organizationId,
      status: opts.status ? (opts.status as any) : { not: 'DELETED' },
      ...(opts.domainId ? { domainId: opts.domainId } : {}),
      ...(opts.q ? { OR: [{ address: { contains: opts.q, mode: 'insensitive' } }, { displayName: { contains: opts.q, mode: 'insensitive' } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.mailbox.count({ where }),
      this.prisma.mailbox.findMany({ where, select: publicFields, orderBy: { address: 'asc' }, skip: (opts.page - 1) * opts.pageSize, take: opts.pageSize }),
    ]);
    return { total, page: opts.page, pageSize: opts.pageSize, items: rows.map(serializeMailbox) };
  }

  async get(organizationId: string, id: string) {
    const m = await this.prisma.mailbox.findFirst({ where: { id, organizationId, status: { not: 'DELETED' } }, select: publicFields });
    if (!m) throw new NotFoundException('Mailbox not found');
    return serializeMailbox(m);
  }

  private async raw(organizationId: string, id: string): Promise<Mailbox> {
    const m = await this.prisma.mailbox.findFirst({ where: { id, organizationId, status: { not: 'DELETED' } } });
    if (!m) throw new NotFoundException('Mailbox not found');
    if (!m.stalwartId) throw new BadRequestException('Mailbox is not provisioned on the mail server');
    return m;
  }

  private assertPassword(pw: string) {
    const r = zPassword.safeParse(pw);
    if (!r.success) throw new BadRequestException(r.error.issues[0].message);
  }

  private assertLocalPart(lp: string): string {
    const r = zLocalPart.safeParse(lp);
    if (!r.success) throw new BadRequestException(`Invalid address: ${r.error.issues[0].message}`);
    return r.data;
  }

  private async assertAddressFree(address: string) {
    const [mb, al] = await Promise.all([this.prisma.mailbox.findUnique({ where: { address } }), this.prisma.alias.findUnique({ where: { address } })]);
    if (mb || al) throw new ConflictException(`${address} is already in use`);
  }

  private async usableDomain(organizationId: string, domainId: string) {
    const d = await this.prisma.domain.findFirst({ where: { id: domainId, organizationId } });
    if (!d) throw new NotFoundException('Domain not found');
    if (!d.stalwartId || !d.verifiedAt) throw new BadRequestException(`Verify ownership of ${d.name} before creating mailboxes`);
    if (d.status === 'SUSPENDED') throw new BadRequestException(`${d.name} is suspended`);
    return d;
  }

  /**
   * Creates the mailbox in PostgreSQL and Stalwart. The DB row is created first (unique constraints
   * reserve the address), then the Stalwart account; if Stalwart fails the row is rolled back.
   */
  async create(p: Principal, organizationId: string, input: CreateMailboxInput, ip?: string, opts: { skipQuotaCheck?: boolean } = {}) {
    const domain = await this.usableDomain(organizationId, input.domainId);
    const localPart = this.assertLocalPart(input.localPart);
    const address = `${localPart}@${domain.name}`;
    const limits = await this.billing.limits(organizationId);
    const quotaMb = Math.min(input.quotaMb ?? limits.storagePerMailboxMb, limits.storagePerMailboxMb);
    if (!opts.skipQuotaCheck) await this.billing.assertCanAdd(organizationId, 'mailbox', 1, quotaMb);
    await this.assertAddressFree(address);

    let password = input.password;
    let temporaryPassword: string | undefined;
    if (!password || input.generatePassword) {
      password = generatePassword();
      temporaryPassword = password;
    } else {
      this.assertPassword(password);
    }

    const row = await this.prisma.mailbox.create({
      data: { organizationId, domainId: domain.id, localPart, address, displayName: input.displayName, quotaMb },
    });
    let stalwartId: string | undefined;
    try {
      stalwartId = await this.stalwart.createUser({ name: localPart, domainId: domain.stalwartId!, password, description: input.displayName, quotaBytes: quotaMb * MB });
      const serviceKey = await this.stalwart.createMailboxServiceKey(stalwartId);
      await this.prisma.$transaction(async (tx) => {
        await tx.mailbox.update({ where: { id: row.id }, data: { stalwartId, serviceKeyEnc: encrypt(serviceKey) } });
        // Mailbox users sign in to JiMail webmail with the mailbox password (verified by Stalwart).
        let user = await tx.user.findUnique({ where: { email: address } });
        if (!user) {
          user = await tx.user.create({ data: { email: address, name: input.displayName, authSource: 'MAILBOX', emailVerifiedAt: new Date() } });
        }
        await tx.membership.upsert({
          where: { userId_organizationId: { userId: user.id, organizationId } },
          update: {},
          create: { userId: user.id, organizationId, role: 'MEMBER' },
        });
        await tx.mailboxAccess.upsert({ where: { userId_mailboxId: { userId: user.id, mailboxId: row.id } }, update: {}, create: { userId: user.id, mailboxId: row.id } });
        // The creating administrator may open the mailbox only when explicitly granted; nothing implicit here.
      });
    } catch (err) {
      logger.error({ err: (err as Error).message, address }, 'Mailbox provisioning failed; rolling back');
      if (stalwartId) await this.stalwart.destroyAccount(stalwartId).catch(() => undefined);
      await this.prisma.mailbox.delete({ where: { id: row.id } }).catch(() => undefined);
      throw new BadRequestException(`Could not create mailbox: ${(err as Error).message}`);
    }
    await this.audit.record(p, { action: 'mailbox.created', organizationId, targetType: 'mailbox', targetId: row.id, metadata: { address, quotaMb }, ip });
    return { mailbox: await this.get(organizationId, row.id), temporaryPassword };
  }

  async update(p: Principal, organizationId: string, id: string, patch: { displayName?: string; quotaMb?: number; sendLimitPerHour?: number | null }, ip?: string) {
    const m = await this.raw(organizationId, id);
    if (patch.quotaMb !== undefined && patch.quotaMb !== m.quotaMb) {
      const limits = await this.billing.limits(organizationId);
      if (patch.quotaMb > limits.storagePerMailboxMb) throw new BadRequestException(`Your plan allows up to ${limits.storagePerMailboxMb} MB per mailbox`);
      const agg = await this.prisma.mailbox.aggregate({ where: { organizationId, status: { not: 'DELETED' }, id: { not: id } }, _sum: { quotaMb: true } });
      if ((agg._sum.quotaMb ?? 0) + patch.quotaMb > limits.maxStorageMb) throw new BadRequestException('Total allocated storage would exceed your plan');
      await this.stalwart.setQuota(m.stalwartId!, patch.quotaMb * MB);
    }
    if (patch.displayName && patch.displayName !== m.displayName) await this.stalwart.setDescription(m.stalwartId!, patch.displayName);
    await this.prisma.mailbox.update({ where: { id }, data: { displayName: patch.displayName, quotaMb: patch.quotaMb, sendLimitPerHour: patch.sendLimitPerHour } });
    await this.audit.record(p, { action: 'mailbox.updated', organizationId, targetType: 'mailbox', targetId: id, metadata: patch, ip });
    return this.get(organizationId, id);
  }

  async resetPassword(p: Principal, organizationId: string, id: string, password: string | undefined, ip?: string) {
    const m = await this.raw(organizationId, id);
    const pw = password ?? generatePassword();
    if (password) this.assertPassword(password);
    await this.stalwart.setPassword(m.stalwartId!, pw);
    // End existing webmail sessions of the mailbox user.
    const user = await this.prisma.user.findUnique({ where: { email: m.address } });
    if (user) await this.prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record(p, { action: 'mailbox.password_reset', organizationId, targetType: 'mailbox', targetId: id, metadata: { generated: !password }, ip });
    return { ok: true, temporaryPassword: password ? undefined : pw };
  }

  async setSuspended(p: Principal, organizationId: string, id: string, suspended: boolean, reason?: string, ip?: string) {
    const m = await this.raw(organizationId, id);
    if (suspended) await this.stalwart.suspendAccount(m.stalwartId!);
    else await this.stalwart.reactivateAccount(m.stalwartId!);
    await this.prisma.mailbox.update({ where: { id }, data: { status: suspended ? 'SUSPENDED' : 'ACTIVE', suspendedReason: suspended ? (reason ?? null) : null } });
    const user = await this.prisma.user.findUnique({ where: { email: m.address } });
    if (user && user.authSource === 'MAILBOX') {
      await this.prisma.user.update({ where: { id: user.id }, data: { status: suspended ? 'SUSPENDED' : 'ACTIVE' } });
      if (suspended) await this.prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await this.audit.record(p, { action: suspended ? 'mailbox.suspended' : 'mailbox.reactivated', organizationId, targetType: 'mailbox', targetId: id, metadata: { reason }, ip });
    return this.get(organizationId, id);
  }

  /** Deletes the Stalwart account (its mail is removed by a Stalwart background task). Irreversible. */
  async remove(p: Principal, organizationId: string, id: string, confirmAddress: string, ip?: string) {
    const m = await this.prisma.mailbox.findFirst({ where: { id, organizationId, status: { not: 'DELETED' } } });
    if (!m) throw new NotFoundException('Mailbox not found');
    if (confirmAddress.toLowerCase() !== m.address) throw new BadRequestException('Type the full mailbox address to confirm deletion');
    const catchAll = await this.prisma.domain.findFirst({ where: { organizationId, catchAllAddress: m.address } });
    if (catchAll) throw new BadRequestException(`This mailbox receives the catch-all of ${catchAll.name}; change it first`);
    if (m.stalwartId) {
      try {
        await this.stalwart.destroyAccount(m.stalwartId);
      } catch (e) {
        if ((e as any).type !== 'notFound') throw new BadRequestException(`Mail server refused deletion: ${(e as Error).message}`);
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.mailbox.delete({ where: { id } });
      const user = await tx.user.findUnique({ where: { email: m.address } });
      if (user?.authSource === 'MAILBOX') await tx.user.delete({ where: { id: user.id } });
    });
    await this.audit.record(p, { action: 'mailbox.deleted', organizationId, targetType: 'mailbox', targetId: id, metadata: { address: m.address }, ip });
    return { ok: true };
  }

  // ───────────── Aliases ─────────────

  async addAlias(p: Principal, organizationId: string, id: string, input: { localPart: string; domainId: string }, ip?: string) {
    const m = await this.raw(organizationId, id);
    const domain = await this.usableDomain(organizationId, input.domainId);
    const localPart = this.assertLocalPart(input.localPart);
    const address = `${localPart}@${domain.name}`;
    await this.assertAddressFree(address);
    const max = await this.prisma.alias.aggregate({ where: { mailboxId: id }, _max: { position: true } });
    const position = (max._max.position ?? -1) + 1;
    const alias = await this.prisma.alias.create({ data: { organizationId, mailboxId: id, domainId: domain.id, localPart, address, position } });
    try {
      await this.stalwart.setAlias(m.stalwartId!, position, { name: localPart, domainId: domain.stalwartId! });
    } catch (e) {
      await this.prisma.alias.delete({ where: { id: alias.id } });
      throw new BadRequestException(`Could not create alias: ${(e as Error).message}`);
    }
    await this.audit.record(p, { action: 'alias.created', organizationId, targetType: 'alias', targetId: alias.id, metadata: { address, mailbox: m.address }, ip });
    return alias;
  }

  async removeAlias(p: Principal, organizationId: string, id: string, aliasId: string, ip?: string) {
    const m = await this.raw(organizationId, id);
    const alias = await this.prisma.alias.findFirst({ where: { id: aliasId, mailboxId: id, organizationId } });
    if (!alias) throw new NotFoundException('Alias not found');
    const catchAll = await this.prisma.domain.findFirst({ where: { organizationId, catchAllAddress: alias.address } });
    if (catchAll) throw new BadRequestException(`This alias receives the catch-all of ${catchAll.name}; change it first`);
    await this.stalwart.setAlias(m.stalwartId!, alias.position, null);
    await this.prisma.alias.delete({ where: { id: aliasId } });
    await this.audit.record(p, { action: 'alias.deleted', organizationId, targetType: 'alias', targetId: aliasId, metadata: { address: alias.address }, ip });
    return { ok: true };
  }

  // ───────────── Forwarding ─────────────

  async setForwarding(p: Principal, organizationId: string, id: string, addresses: string[], keepCopy: boolean, ip?: string) {
    const m = await this.raw(organizationId, id);
    const uniq = [...new Set(addresses.map((a) => a.toLowerCase()))];
    if (uniq.includes(m.address)) throw new BadRequestException('A mailbox cannot forward to itself');
    if (uniq.length > 10) throw new BadRequestException('At most 10 forwarding addresses');
    const ruleId = await this.stalwart.setForwarding(m.stalwartId!, m.forwardRuleId, uniq, keepCopy);
    await this.prisma.mailbox.update({ where: { id }, data: { forwardTo: uniq, forwardKeepCopy: keepCopy, forwardRuleId: ruleId } });
    await this.audit.record(p, { action: uniq.length ? 'mailbox.forwarding_set' : 'mailbox.forwarding_removed', organizationId, targetType: 'mailbox', targetId: id, metadata: { to: uniq, keepCopy }, ip });
    return this.get(organizationId, id);
  }

  // ───────────── Usage ─────────────

  async syncUsage(organizationId?: string) {
    const mailboxes = await this.prisma.mailbox.findMany({ where: { status: { not: 'DELETED' }, stalwartId: { not: null }, ...(organizationId ? { organizationId } : {}) }, select: { id: true, stalwartId: true } });
    const accounts = await this.stalwart.getAccounts(mailboxes.map((m) => m.stalwartId!));
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const now = new Date();
    for (const m of mailboxes) {
      const a = byId.get(m.stalwartId!);
      if (a) await this.prisma.mailbox.update({ where: { id: m.id }, data: { usedBytes: BigInt(a.usedDiskQuota ?? 0), usageSyncedAt: now } });
    }
    return { synced: accounts.length };
  }

  connectionSettings(address: string) {
    const c = this.cfg;
    return {
      username: address,
      imap: { host: c.MAIL_HOSTNAME, port: c.IMAP_PORT, security: 'SSL/TLS' },
      smtp: { host: c.MAIL_HOSTNAME, port: c.SMTP_SUBMISSION_PORT, security: 'SSL/TLS', ...(c.SMTP_STARTTLS_PORT ? { startTlsPort: c.SMTP_STARTTLS_PORT } : {}) },
      pop3: { host: c.MAIL_HOSTNAME, port: c.POP3_PORT, security: 'SSL/TLS' },
      caldav: `https://${c.MAIL_HOSTNAME}/dav/cal/`,
      carddav: `https://${c.MAIL_HOSTNAME}/dav/card/`,
      authentication: 'Normal password (PLAIN/LOGIN over TLS) using the full email address as the user name',
    };
  }

  // ───────────── Bulk CSV import ─────────────

  async importCsv(p: Principal, organizationId: string, csv: string, ip?: string) {
    const parsed = Papa.parse<Record<string, string>>(csv.trim(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
    if (parsed.errors.length) throw new BadRequestException(`CSV error on row ${(parsed.errors[0].row ?? 0) + 2}: ${parsed.errors[0].message}`);
    if (!parsed.data.length) throw new BadRequestException('The CSV file has no rows');
    if (parsed.data.length > 500) throw new BadRequestException('Import at most 500 mailboxes at a time');
    const domains = await this.prisma.domain.findMany({ where: { organizationId } });
    const byName = new Map(domains.map((d) => [d.name, d]));
    const row = z.object({
      address: z.string().trim().toLowerCase(),
      name: z.string().trim().min(1).max(100),
      quota_mb: z.coerce.number().int().min(50).max(1048576).optional(),
      password: z.string().optional(),
    });

    const errors: { row: number; message: string }[] = [];
    const seen = new Set<string>();
    const plan: (CreateMailboxInput & { address: string; rowNo: number })[] = [];
    parsed.data.forEach((raw, i) => {
      const rowNo = i + 2;
      const r = row.safeParse({ ...raw, name: raw.name ?? raw.display_name, quota_mb: raw.quota_mb || undefined, password: raw.password || undefined });
      if (!r.success) return errors.push({ row: rowNo, message: r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
      const [local, dom] = r.data.address.split('@');
      const d = dom ? byName.get(dom) : undefined;
      if (!local || !d) return errors.push({ row: rowNo, message: `Domain of ${r.data.address} is not part of this organisation` });
      if (!d.verifiedAt) return errors.push({ row: rowNo, message: `${d.name} is not verified yet` });
      if (!zLocalPart.safeParse(local).success) return errors.push({ row: rowNo, message: `Invalid local part "${local}"` });
      if (r.data.password && !zPassword.safeParse(r.data.password).success) return errors.push({ row: rowNo, message: 'Password does not meet the policy' });
      if (seen.has(r.data.address)) return errors.push({ row: rowNo, message: `Duplicate address ${r.data.address} in file` });
      seen.add(r.data.address);
      plan.push({ rowNo, address: r.data.address, domainId: d.id, localPart: local, displayName: r.data.name, quotaMb: r.data.quota_mb, password: r.data.password });
    });
    const taken = await this.prisma.mailbox.findMany({ where: { address: { in: [...seen] } }, select: { address: true } });
    const takenAliases = await this.prisma.alias.findMany({ where: { address: { in: [...seen] } }, select: { address: true } });
    for (const t of [...taken, ...takenAliases]) {
      const item = plan.find((x) => x.address === t.address);
      if (item) errors.push({ row: item.rowNo, message: `${t.address} already exists` });
    }
    if (errors.length) return { created: [], errors: errors.sort((a, b) => a.row - b.row), dryRunFailed: true };

    const limits = await this.billing.limits(organizationId);
    const totalMb = plan.reduce((s, x) => s + Math.min(x.quotaMb ?? limits.storagePerMailboxMb, limits.storagePerMailboxMb), 0);
    await this.billing.assertCanAdd(organizationId, 'mailbox', plan.length, totalMb);

    // Validation passed for every row; provision sequentially and report per-row outcomes.
    const created: { row: number; address: string; temporaryPassword?: string }[] = [];
    for (const item of plan) {
      try {
        const r = await this.create(p, organizationId, { ...item, generatePassword: !item.password }, ip, { skipQuotaCheck: true });
        created.push({ row: item.rowNo, address: item.address, temporaryPassword: r.temporaryPassword });
      } catch (e) {
        errors.push({ row: item.rowNo, message: (e as Error).message });
      }
    }
    await this.audit.record(p, { action: 'mailbox.bulk_import', organizationId, metadata: { created: created.length, failed: errors.length }, ip });
    return { created, errors, dryRunFailed: false };
  }
}
