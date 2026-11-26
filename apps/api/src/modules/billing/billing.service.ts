import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Plan, Prisma, Subscription } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { loadConfig } from '../../config/config';
import { safeEqual } from '../../common/crypto';
import { logger } from '../../common/logger';
import { PrismaService } from '../../common/prisma.service';

export const DEFAULT_PLANS: Omit<Prisma.PlanCreateInput, 'subscriptions'>[] = [
  {
    code: 'starter',
    name: 'Starter',
    description: 'For freelancers and small teams getting started with their own domain.',
    priceMonthlyCents: 900,
    maxMailboxes: 5,
    maxDomains: 1,
    storagePerMailboxMb: 5120,
    maxStorageMb: 25600,
    sendLimitPerHour: 100,
    trialDays: 14,
    features: ['Custom domain', 'Webmail', 'IMAP/SMTP access', 'DKIM, SPF & DMARC guidance'],
    sortOrder: 1,
  },
  {
    code: 'business',
    name: 'Business',
    description: 'For growing companies that need more mailboxes, domains and control.',
    priceMonthlyCents: 2900,
    maxMailboxes: 50,
    maxDomains: 5,
    storagePerMailboxMb: 15360,
    maxStorageMb: 512000,
    sendLimitPerHour: 500,
    trialDays: 14,
    features: ['Everything in Starter', 'Up to 5 domains', 'Aliases & forwarding', 'API access', 'Audit logs'],
    sortOrder: 2,
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    description: 'Custom limits, priority support and organisation-level controls.',
    priceMonthlyCents: 0,
    maxMailboxes: 1000,
    maxDomains: 50,
    storagePerMailboxMb: 51200,
    maxStorageMb: 10240000,
    sendLimitPerHour: 2000,
    trialDays: 30,
    features: ['Custom limits', 'Priority support', 'Enforced 2FA policies', 'Dedicated onboarding'],
    isPublic: true,
    sortOrder: 3,
  },
];

export interface EffectiveLimits {
  planCode: string;
  maxMailboxes: number;
  maxDomains: number;
  maxStorageMb: number;
  storagePerMailboxMb: number;
  sendLimitPerHour: number;
  status: Subscription['status'] | 'NONE';
  writable: boolean;
}

@Injectable()
export class BillingService {
  private readonly cfg = loadConfig();
  constructor(private readonly prisma: PrismaService) {}

  async ensurePlans() {
    for (const p of DEFAULT_PLANS) {
      await this.prisma.plan.upsert({ where: { code: p.code }, update: {}, create: p });
    }
  }

  async startTrial(tx: Prisma.TransactionClient, organizationId: string, planCode = 'starter') {
    let plan = await tx.plan.findUnique({ where: { code: planCode } });
    if (!plan) {
      for (const p of DEFAULT_PLANS) await tx.plan.upsert({ where: { code: p.code }, update: {}, create: p });
      plan = await tx.plan.findUniqueOrThrow({ where: { code: planCode } });
    }
    const now = new Date();
    const end = new Date(now.getTime() + plan.trialDays * 86400_000);
    return tx.subscription.create({
      data: { organizationId, planId: plan.id, status: 'TRIALING', trialEndsAt: end, currentPeriodStart: now, currentPeriodEnd: end, provider: 'manual' },
    });
  }

  async limits(organizationId: string): Promise<EffectiveLimits> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, include: { subscription: { include: { plan: true } } } });
    const plan = org.subscription?.plan;
    const status = org.subscription?.status ?? 'NONE';
    return {
      planCode: plan?.code ?? 'none',
      maxMailboxes: org.maxMailboxesOverride ?? plan?.maxMailboxes ?? 0,
      maxDomains: org.maxDomainsOverride ?? plan?.maxDomains ?? 0,
      maxStorageMb: org.maxStorageMbOverride ?? plan?.maxStorageMb ?? 0,
      storagePerMailboxMb: plan?.storagePerMailboxMb ?? 1024,
      sendLimitPerHour: org.sendLimitPerHourOverride ?? plan?.sendLimitPerHour ?? 50,
      status,
      writable: org.status === 'ACTIVE' && ['TRIALING', 'ACTIVE', 'PAST_DUE'].includes(status),
    };
  }

  /** Enforces plan quotas before resources are created. */
  async assertCanAdd(organizationId: string, kind: 'mailbox' | 'domain', count = 1, extraStorageMb = 0) {
    const l = await this.limits(organizationId);
    if (!l.writable) throw new ForbiddenException('Your subscription is not active. Update billing to add resources.');
    if (kind === 'domain') {
      const n = await this.prisma.domain.count({ where: { organizationId } });
      if (n + count > l.maxDomains) throw new ForbiddenException(`Your plan allows ${l.maxDomains} domain(s). Upgrade to add more.`);
    } else {
      const agg = await this.prisma.mailbox.aggregate({ where: { organizationId, status: { not: 'DELETED' } }, _count: true, _sum: { quotaMb: true } });
      if (agg._count + count > l.maxMailboxes) throw new ForbiddenException(`Your plan allows ${l.maxMailboxes} mailbox(es). Upgrade to add more.`);
      if ((agg._sum.quotaMb ?? 0) + extraStorageMb > l.maxStorageMb) {
        throw new ForbiddenException(`Allocated storage would exceed your plan limit of ${Math.round(l.maxStorageMb / 1024)} GB.`);
      }
    }
    return l;
  }

  async overview(organizationId: string) {
    const [sub, invoices, limits, usage] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { organizationId }, include: { plan: true } }),
      this.prisma.invoice.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.limits(organizationId),
      this.prisma.mailbox.aggregate({ where: { organizationId, status: { not: 'DELETED' } }, _count: true, _sum: { quotaMb: true, usedBytes: true } }),
    ]);
    const domains = await this.prisma.domain.count({ where: { organizationId } });
    return {
      subscription: sub,
      invoices,
      limits,
      usage: { mailboxes: usage._count, domains, allocatedStorageMb: usage._sum.quotaMb ?? 0, usedBytes: Number(usage._sum.usedBytes ?? 0) },
      provider: { name: this.cfg.BILLING_PROVIDER, configured: this.cfg.BILLING_PROVIDER === 'stripe' && !!this.cfg.STRIPE_SECRET_KEY },
    };
  }

  plans(includeHidden = false) {
    return this.prisma.plan.findMany({ where: includeHidden ? {} : { isPublic: true, isActive: true }, orderBy: { sortOrder: 'asc' } });
  }

  /** Change plan. Downgrades are refused when current usage exceeds the new plan's limits. */
  async changePlan(organizationId: string, planCode: string, opts: { admin: boolean }) {
    const plan = await this.prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan || (!plan.isActive && !opts.admin)) throw new NotFoundException('Plan not found');
    await this.assertFits(organizationId, plan);
    const sub = await this.prisma.subscription.findUnique({ where: { organizationId } });
    if (!sub) throw new NotFoundException('No subscription');
    if (this.cfg.BILLING_PROVIDER === 'stripe' && sub.provider === 'stripe' && !opts.admin) {
      // Paid subscriptions are changed through the provider's checkout/portal so payment is collected.
      return { requiresCheckout: true, ...(await this.createCheckout(organizationId, planCode)) };
    }
    if (!opts.admin && sub.status !== 'TRIALING') {
      throw new BadRequestException('Online payments are not configured. Contact the platform administrator to change plans.');
    }
    return this.prisma.subscription.update({ where: { organizationId }, data: { planId: plan.id } });
  }

  async assertFits(organizationId: string, plan: Plan) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const agg = await this.prisma.mailbox.aggregate({ where: { organizationId, status: { not: 'DELETED' } }, _count: true, _sum: { quotaMb: true } });
    const domains = await this.prisma.domain.count({ where: { organizationId } });
    const maxMb = org.maxMailboxesOverride ?? plan.maxMailboxes;
    const problems: string[] = [];
    if (agg._count > maxMb) problems.push(`${agg._count} mailboxes (plan allows ${maxMb})`);
    if (domains > (org.maxDomainsOverride ?? plan.maxDomains)) problems.push(`${domains} domains (plan allows ${plan.maxDomains})`);
    if ((agg._sum.quotaMb ?? 0) > (org.maxStorageMbOverride ?? plan.maxStorageMb)) problems.push('allocated storage above the plan limit');
    if (problems.length) throw new BadRequestException(`Cannot switch to ${plan.name}: you currently have ${problems.join(', ')}.`);
  }

  // ───────────────────── Lifecycle (run by worker) ─────────────────────

  async runLifecycle(now = new Date()) {
    const grace = this.cfg.BILLING_GRACE_DAYS * 86400_000;
    const expiredTrials = await this.prisma.subscription.findMany({ where: { status: 'TRIALING', trialEndsAt: { lt: now } } });
    for (const s of expiredTrials) {
      await this.prisma.subscription.update({ where: { id: s.id }, data: { status: 'PAST_DUE', graceEndsAt: new Date(now.getTime() + grace) } });
      await this.notifyOrg(s.organizationId, 'Your trial has ended', `Add a payment method within ${this.cfg.BILLING_GRACE_DAYS} days to keep your mailboxes active.`, 'WARNING');
    }
    const lapsedManual = await this.prisma.subscription.findMany({ where: { status: 'ACTIVE', provider: 'manual', currentPeriodEnd: { lt: now } } });
    for (const s of lapsedManual) {
      await this.prisma.subscription.update({ where: { id: s.id }, data: { status: 'PAST_DUE', graceEndsAt: new Date(now.getTime() + grace) } });
    }
    const overdue = await this.prisma.subscription.findMany({ where: { status: 'PAST_DUE', graceEndsAt: { lt: now } } });
    for (const s of overdue) {
      await this.prisma.subscription.update({ where: { id: s.id }, data: { status: 'SUSPENDED' } });
      await this.notifyOrg(s.organizationId, 'Subscription suspended', 'Your grace period has ended. New resources cannot be created until billing is resolved.', 'CRITICAL');
      await this.prisma.securityEvent.create({ data: { organizationId: s.organizationId, type: 'billing.suspended', severity: 'WARNING', message: 'Subscription suspended for non-payment' } });
    }
    return { expiredTrials: expiredTrials.length, lapsed: lapsedManual.length, suspended: overdue.length };
  }

  private async notifyOrg(organizationId: string, title: string, body: string, level: 'INFO' | 'WARNING' | 'CRITICAL') {
    const owners = await this.prisma.membership.findMany({ where: { organizationId, role: { in: ['OWNER', 'ADMIN'] } } });
    await this.prisma.notification.createMany({ data: owners.map((o) => ({ userId: o.userId, organizationId, title, body, level })) });
  }

  // ───────────────────── Stripe (REST, no SDK) ─────────────────────

  private async stripe(path: string, params: Record<string, string>) {
    if (this.cfg.BILLING_PROVIDER !== 'stripe' || !this.cfg.STRIPE_SECRET_KEY) {
      throw new ServiceUnavailableException('Online payments are not configured on this installation');
    }
    const r = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.cfg.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const json = (await r.json()) as any;
    if (!r.ok) throw new BadRequestException(json?.error?.message ?? 'Payment provider error');
    return json;
  }

  async createCheckout(organizationId: string, planCode: string) {
    const plan = await this.prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan?.stripePriceId) throw new BadRequestException('This plan is not available for online purchase. Contact sales.');
    const sub = await this.prisma.subscription.findUnique({ where: { organizationId } });
    const session = await this.stripe('checkout/sessions', {
      mode: 'subscription',
      'line_items[0][price]': plan.stripePriceId,
      'line_items[0][quantity]': '1',
      client_reference_id: organizationId,
      'metadata[organizationId]': organizationId,
      'metadata[planCode]': plan.code,
      'subscription_data[metadata][organizationId]': organizationId,
      'subscription_data[metadata][planCode]': plan.code,
      ...(sub?.providerCustomerId ? { customer: sub.providerCustomerId } : {}),
      success_url: `${this.cfg.APP_URL}/org/${organizationId}/billing?checkout=success`,
      cancel_url: `${this.cfg.APP_URL}/org/${organizationId}/billing?checkout=cancelled`,
    });
    return { url: session.url as string };
  }

  async createPortal(organizationId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { organizationId } });
    if (!sub?.providerCustomerId) throw new BadRequestException('No billing account yet. Choose a plan first.');
    const s = await this.stripe('billing_portal/sessions', { customer: sub.providerCustomerId, return_url: `${this.cfg.APP_URL}/org/${organizationId}/billing` });
    return { url: s.url as string };
  }

  /** Verifies the Stripe-Signature header (t=...,v1=...) over the raw body. */
  verifyStripeSignature(raw: Buffer, header: string | undefined, toleranceSec = 300): boolean {
    const secret = this.cfg.STRIPE_WEBHOOK_SECRET;
    if (!secret || !header) return false;
    const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
    const t = Number(parts.t);
    if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
    const expected = createHmac('sha256', secret).update(`${t}.${raw.toString('utf8')}`).digest('hex');
    const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
    return sigs.some((s) => safeEqual(s, expected));
  }

  async handleStripeEvent(event: any) {
    const seen = await this.prisma.billingEvent.findUnique({ where: { providerEventId: event.id } });
    if (seen) return { duplicate: true };
    const obj = event.data?.object ?? {};
    switch (event.type) {
      case 'checkout.session.completed': {
        const orgId = obj.metadata?.organizationId ?? obj.client_reference_id;
        const plan = await this.prisma.plan.findUnique({ where: { code: obj.metadata?.planCode ?? '' } });
        if (orgId && plan) {
          await this.prisma.subscription.update({
            where: { organizationId: orgId },
            data: { planId: plan.id, provider: 'stripe', providerCustomerId: obj.customer, providerSubscriptionId: obj.subscription, status: 'ACTIVE', graceEndsAt: null, trialEndsAt: null },
          });
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created':
      case 'customer.subscription.deleted': {
        const sub = await this.prisma.subscription.findFirst({ where: { OR: [{ providerSubscriptionId: obj.id }, { organizationId: obj.metadata?.organizationId ?? '' }] } });
        if (!sub) break;
        const map: Record<string, Subscription['status']> = { active: 'ACTIVE', trialing: 'TRIALING', past_due: 'PAST_DUE', unpaid: 'SUSPENDED', canceled: 'CANCELED', incomplete_expired: 'CANCELED' };
        const status = event.type === 'customer.subscription.deleted' ? 'CANCELED' : (map[obj.status] ?? sub.status);
        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: {
            status,
            providerSubscriptionId: obj.id,
            cancelAtPeriodEnd: !!obj.cancel_at_period_end,
            currentPeriodStart: obj.current_period_start ? new Date(obj.current_period_start * 1000) : sub.currentPeriodStart,
            currentPeriodEnd: obj.current_period_end ? new Date(obj.current_period_end * 1000) : sub.currentPeriodEnd,
            graceEndsAt: status === 'PAST_DUE' ? (sub.graceEndsAt ?? new Date(Date.now() + this.cfg.BILLING_GRACE_DAYS * 86400_000)) : null,
          },
        });
        break;
      }
      case 'invoice.created':
      case 'invoice.finalized':
      case 'invoice.paid':
      case 'invoice.payment_failed':
      case 'invoice.voided': {
        const sub = await this.prisma.subscription.findFirst({ where: { OR: [{ providerSubscriptionId: obj.subscription ?? '' }, { providerCustomerId: obj.customer ?? '' }] } });
        if (!sub) break;
        const statusMap: Record<string, any> = { draft: 'DRAFT', open: 'OPEN', paid: 'PAID', void: 'VOID', uncollectible: 'UNCOLLECTIBLE' };
        const inv = await this.prisma.invoice.upsert({
          where: { providerInvoiceId: obj.id },
          update: { status: statusMap[obj.status] ?? 'OPEN', amountPaidCents: obj.amount_paid ?? 0, hostedUrl: obj.hosted_invoice_url, number: obj.number },
          create: {
            organizationId: sub.organizationId,
            provider: 'stripe',
            providerInvoiceId: obj.id,
            number: obj.number,
            status: statusMap[obj.status] ?? 'OPEN',
            amountDueCents: obj.amount_due ?? 0,
            amountPaidCents: obj.amount_paid ?? 0,
            currency: (obj.currency ?? 'eur').toUpperCase(),
            hostedUrl: obj.hosted_invoice_url,
            periodStart: obj.period_start ? new Date(obj.period_start * 1000) : null,
            periodEnd: obj.period_end ? new Date(obj.period_end * 1000) : null,
          },
        });
        if (event.type === 'invoice.paid' && obj.payment_intent) {
          await this.prisma.payment.upsert({
            where: { providerPaymentId: String(obj.payment_intent) },
            update: { status: 'succeeded' },
            create: { organizationId: sub.organizationId, invoiceId: inv.id, amountCents: obj.amount_paid ?? 0, currency: inv.currency, status: 'succeeded', provider: 'stripe', providerPaymentId: String(obj.payment_intent) },
          });
        }
        if (event.type === 'invoice.payment_failed') {
          await this.prisma.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE', graceEndsAt: sub.graceEndsAt ?? new Date(Date.now() + this.cfg.BILLING_GRACE_DAYS * 86400_000) } });
          await this.notifyOrg(sub.organizationId, 'Payment failed', 'We could not collect your latest payment. Update your payment method to avoid suspension.', 'WARNING');
        }
        break;
      }
      default:
        logger.debug({ type: event.type }, 'Unhandled billing event');
    }
    await this.prisma.billingEvent.create({ data: { provider: 'stripe', providerEventId: event.id, type: event.type } });
    return { ok: true };
  }
}
