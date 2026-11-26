import { Injectable } from '@nestjs/common';
import { DeliveryDirection, Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { loadConfig } from '../../config/config';
import { safeEqual } from '../../common/crypto';
import { logger } from '../../common/logger';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { StalwartClient } from '../stalwart/stalwart.client';

export interface StalwartEvent {
  id: string;
  createdAt: string;
  type: string;
  data: Record<string, any>;
}

/** Maps Stalwart telemetry event names to JiMail delivery categories. */
export function categorize(type: string): { category: string; direction?: DeliveryDirection } | null {
  switch (type) {
    case 'delivery.delivered':
      return { category: 'delivered', direction: 'OUTBOUND' };
    case 'delivery.failed':
    case 'delivery.rcpt-to-rejected':
      return { category: 'failed', direction: 'OUTBOUND' };
    case 'delivery.dsn-perm-fail':
      return { category: 'bounce', direction: 'OUTBOUND' };
    case 'delivery.dsn-temp-fail':
      return { category: 'temp_fail', direction: 'OUTBOUND' };
    case 'queue.authenticated-message-queued':
      return { category: 'queued_outbound', direction: 'OUTBOUND' };
    case 'queue.message-queued':
      return { category: 'queued_inbound', direction: 'INBOUND' };
    case 'queue.rate-limit-exceeded':
    case 'queue.quota-exceeded':
      return { category: 'rate_limited', direction: 'OUTBOUND' };
    case 'message-ingest.ham':
      return { category: 'ham', direction: 'INBOUND' };
    case 'message-ingest.spam':
      return { category: 'spam', direction: 'INBOUND' };
    case 'auth.failed':
    case 'auth.too-many-attempts':
      return { category: 'auth_failed' };
    case 'security.authentication-ban':
    case 'security.abuse-ban':
      return { category: 'ip_banned' };
    case 'incoming-report.abuse-report':
      return { category: 'abuse_report' };
    case 'smtp.relay-not-allowed':
      return { category: 'relay_denied', direction: 'INBOUND' };
    default:
      return null;
  }
}

const first = (v: unknown): string | undefined => (Array.isArray(v) ? (v[0] as string) : typeof v === 'string' ? v : undefined);
const emailish = (v?: string) => (v && v.includes('@') && v !== '<>' ? v.replace(/^<|>$/g, '').toLowerCase() : undefined);

@Injectable()
export class DeliveryService {
  private readonly cfg = loadConfig();
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly stalwart: StalwartClient,
  ) {}

  verifySignature(raw: Buffer, signature: string | undefined): boolean {
    const key = this.cfg.STALWART_WEBHOOK_SECRET;
    if (!key || !signature) return false;
    const expected = createHmac('sha256', key).update(raw).digest('base64');
    return safeEqual(expected, signature);
  }

  async ingest(events: StalwartEvent[]) {
    let stored = 0;
    for (const e of events) {
      const cat = categorize(e.type);
      if (!cat) continue;
      const d = e.data ?? {};
      const sender = emailish(first(d.from)) ?? emailish(first(d.accountName));
      const recipients: string[] = (Array.isArray(d.to) ? d.to : d.to ? [d.to] : []).map((x: string) => emailish(x)).filter((x: string | undefined): x is string => !!x);
      // The local party decides tenant attribution: sender for outbound, recipient for inbound.
      const localAddr = cat.direction === 'INBOUND' ? recipients[0] : (sender ?? recipients[0]);
      const owner = localAddr ? await this.resolveOwner(localAddr) : null;
      try {
        await this.prisma.deliveryEvent.create({
          data: {
            stalwartEventId: String(e.id),
            type: e.type,
            category: cat.category,
            direction: cat.direction,
            sender: sender ?? null,
            recipient: recipients.join(', ').slice(0, 1000) || null,
            remoteIp: d.remoteIp ?? null,
            detail: (d.details ?? d.reason ?? d.hostname ?? null)?.toString().slice(0, 1000) ?? null,
            occurredAt: new Date(e.createdAt),
            organizationId: owner?.organizationId ?? null,
            mailboxId: owner?.mailboxId ?? null,
          },
        });
        stored++;
      } catch (err) {
        if ((err as Prisma.PrismaClientKnownRequestError).code !== 'P2002') throw err; // duplicates are expected on retries
        continue;
      }
      if (owner?.mailboxId) await this.trackAbuse(owner.mailboxId, owner.organizationId, cat.category);
      if (cat.category === 'abuse_report' || cat.category === 'ip_banned') {
        await this.prisma.securityEvent.create({
          data: { organizationId: owner?.organizationId ?? null, type: `mail.${cat.category}`, severity: 'WARNING', message: `${e.type}${d.remoteIp ? ` from ${d.remoteIp}` : ''}`, metadata: d as Prisma.InputJsonValue },
        });
      }
    }
    return { received: events.length, stored };
  }

  private async resolveOwner(address: string): Promise<{ organizationId: string; mailboxId: string | null } | null> {
    const cacheKey = `owner:${address}`;
    const cached = await this.redis.client.get(cacheKey);
    if (cached) return cached === '-' ? null : JSON.parse(cached);
    let res: { organizationId: string; mailboxId: string | null } | null = null;
    const mb = await this.prisma.mailbox.findUnique({ where: { address }, select: { id: true, organizationId: true } });
    if (mb) res = { organizationId: mb.organizationId, mailboxId: mb.id };
    else {
      const al = await this.prisma.alias.findUnique({ where: { address }, select: { mailboxId: true, organizationId: true } });
      if (al) res = { organizationId: al.organizationId, mailboxId: al.mailboxId };
      else {
        const domain = address.split('@')[1];
        const dom = domain ? await this.prisma.domain.findUnique({ where: { name: domain }, select: { organizationId: true } }) : null;
        if (dom) res = { organizationId: dom.organizationId, mailboxId: null };
      }
    }
    await this.redis.client.set(cacheKey, res ? JSON.stringify(res) : '-', 'EX', 300);
    return res;
  }

  /**
   * Abuse heuristics per mailbox (rolling hour): sending volume above the plan limit or a burst of
   * failed deliveries suggests a compromised account. Outgoing mail is then blocked and admins alerted.
   */
  private async trackAbuse(mailboxId: string, organizationId: string, category: string) {
    if (!['queued_outbound', 'failed', 'bounce'].includes(category)) return;
    const hour = Math.floor(Date.now() / 3600_000);
    const key = `abuse:${mailboxId}:${category === 'queued_outbound' ? 'sent' : 'fail'}:${hour}`;
    const n = await this.redis.client.incr(key);
    await this.redis.client.expire(key, 7200);
    const mb = await this.prisma.mailbox.findUnique({ where: { id: mailboxId }, include: { organization: { include: { subscription: { include: { plan: true } } } } } });
    if (!mb || mb.status !== 'ACTIVE' || !mb.stalwartId) return;
    const sendLimit = mb.sendLimitPerHour ?? mb.organization.sendLimitPerHourOverride ?? mb.organization.subscription?.plan.sendLimitPerHour ?? 100;
    const over = category === 'queued_outbound' ? n > sendLimit : n > this.cfg.ABUSE_FAILED_DELIVERY_THRESHOLD;
    if (!over) return;
    const flagKey = `abuse-flag:${mailboxId}:${hour}`;
    if (!(await this.redis.client.set(flagKey, '1', 'EX', 7200, 'NX'))) return; // once per hour
    const reason = category === 'queued_outbound' ? `Sent more than ${sendLimit} messages in one hour` : `More than ${this.cfg.ABUSE_FAILED_DELIVERY_THRESHOLD} failed deliveries in one hour`;
    await this.prisma.securityEvent.create({
      data: { organizationId, type: 'mailbox.suspicious_sending', severity: 'CRITICAL', message: `${mb.address}: ${reason}`, metadata: { mailboxId, autoBlocked: this.cfg.ABUSE_AUTO_SUSPEND } },
    });
    if (this.cfg.ABUSE_AUTO_SUSPEND) {
      await this.stalwart.blockSending(mb.stalwartId).catch((e) => logger.error({ err: (e as Error).message }, 'Failed to block sending'));
      await this.prisma.mailbox.update({ where: { id: mailboxId }, data: { status: 'SUSPENDED', suspendedReason: `Automatic: ${reason}. Outgoing mail blocked pending review.` } });
      await this.prisma.auditLog.create({ data: { organizationId, action: 'mailbox.auto_suspended', targetType: 'mailbox', targetId: mailboxId, metadata: { reason } } });
    }
    const admins = await this.prisma.membership.findMany({ where: { organizationId, role: { in: ['OWNER', 'ADMIN'] } } });
    await this.prisma.notification.createMany({
      data: admins.map((a) => ({ userId: a.userId, organizationId, level: 'CRITICAL' as const, title: 'Suspicious sending detected', body: `${mb.address}: ${reason}.${this.cfg.ABUSE_AUTO_SUSPEND ? ' Outgoing mail has been blocked.' : ''}` })),
    });
  }
}
