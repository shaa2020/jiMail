import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { loadConfig } from '../../config/config';
import { ClientIp, CurrentPrincipal, SuperAdmin } from '../../common/decorators';
import { AuditService } from '../../common/audit.service';
import { UserPrincipal } from '../../common/principal';
import { PrismaService } from '../../common/prisma.service';
import { ApiZodBody, zEmail, ZodPipe, zPage } from '../../common/zod';
import { BillingService } from '../billing/billing.service';
import { DomainsService } from '../domains/domains.service';
import { MailboxesService } from '../mailboxes/mailboxes.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { StalwartClient } from '../stalwart/stalwart.client';
import { AdminService } from './admin.service';

const orgList = zPage.extend({ status: z.enum(['ACTIVE', 'SUSPENDED', 'PENDING_DELETION']).optional() });
const createOrg = z.object({ name: z.string().trim().min(2).max(100), ownerEmail: zEmail, planCode: z.string().optional() });
const nullableInt = z.number().int().min(0).nullable().optional();
const updateOrg = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  maxMailboxesOverride: nullableInt,
  maxDomainsOverride: nullableInt,
  maxStorageMbOverride: nullableInt,
  sendLimitPerHourOverride: nullableInt,
});
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
const deleteSchema = z.object({ confirmName: z.string().min(1) });
const roleSchema = z.object({ platformRole: z.enum(['SUPER_ADMIN', 'USER']) });
const statusSchema = z.object({ suspended: z.boolean(), reason: z.string().max(500).optional() });
const planSchema = z.object({
  code: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().min(1).max(60),
  description: z.string().max(500).default(''),
  priceMonthlyCents: z.number().int().min(0),
  currency: z.string().length(3).default('EUR'),
  maxMailboxes: z.number().int().min(1),
  maxDomains: z.number().int().min(1),
  storagePerMailboxMb: z.number().int().min(50),
  maxStorageMb: z.number().int().min(50),
  sendLimitPerHour: z.number().int().min(1),
  trialDays: z.number().int().min(0).max(365).default(14),
  features: z.array(z.string().max(120)).max(20).default([]),
  isPublic: z.boolean().default(true),
  isActive: z.boolean().default(true),
  stripePriceId: z.string().max(100).nullable().optional(),
  sortOrder: z.number().int().default(0),
});
const subSchema = z.object({
  planCode: z.string().optional(),
  status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED']).optional(),
  currentPeriodEnd: z.string().datetime().optional(),
});
const settingSchema = z.object({ value: z.unknown() });
const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(14) });
const domainAction = z.object({ suspended: z.boolean(), reason: z.string().max(500).optional() });

@ApiTags('admin')
@SuperAdmin()
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly prisma: PrismaService,
    private readonly orgs: OrganizationsService,
    private readonly billing: BillingService,
    private readonly monitoring: MonitoringService,
    private readonly stalwart: StalwartClient,
    private readonly domains: DomainsService,
    private readonly mailboxes: MailboxesService,
    private readonly audit: AuditService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Platform overview for the super admin dashboard' })
  overview() {
    return this.admin.overview();
  }

  @Get('organizations')
  listOrgs(@Query(new ZodPipe(orgList)) q: z.infer<typeof orgList>) {
    return this.admin.listOrgs(q);
  }

  @Post('organizations')
  @ApiZodBody(createOrg)
  createOrg(@Body(new ZodPipe(createOrg)) b: z.infer<typeof createOrg>, @CurrentPrincipal() p: UserPrincipal, @ClientIp() ip: string) {
    return this.admin.createOrg(p, b, ip);
  }

  @Get('organizations/:id')
  orgDetail(@Param('id') id: string) {
    return this.admin.orgDetail(id);
  }

  @Patch('organizations/:id')
  @ApiZodBody(updateOrg)
  updateOrg(@Param('id') id: string, @Body(new ZodPipe(updateOrg)) b: z.infer<typeof updateOrg>, @CurrentPrincipal() p: UserPrincipal, @ClientIp() ip: string) {
    return this.admin.updateOrg(p, id, b, ip);
  }

  @Post('organizations/:id/suspend')
  @HttpCode(200)
  @ApiZodBody(reasonSchema)
  suspend(@Param('id') id: string, @Body(new ZodPipe(reasonSchema)) b: z.infer<typeof reasonSchema>, @CurrentPrincipal() p: UserPrincipal, @ClientIp() ip: string) {
    return this.admin.suspendOrg(p, id, b.reason, ip);
  }

  @Post('organizations/:id/reactivate')
  @HttpCode(200)
  reactivate(@Param('id') id: string, @CurrentPrincipal() p: UserPrincipal, @ClientIp() ip: string) {
    return this.admin.reactivateOrg(p, id, ip);
  }

  @Delete('organizations/:id')
  @ApiZodBody(deleteSchema)
  deleteOrg(@Param('id') id: string, @Body(new ZodPipe(deleteSchema)) b: z.infer<typeof deleteSchema>, @CurrentPrincipal() p: UserPrincipal, @ClientIp() ip: string) {
    return this.admin.deleteOrg(p, id, b.confirmName, ip);
  }

  @Put('organizations/:id/subscription')
  @ApiZodBody(subSchema)
  @ApiOperation({ summary: 'Manually adjust a subscription (e.g. invoiced customers). Recorded in the audit log.' })
  async setSubscription(@Param('id') id: string, @Body(new ZodPipe(subSchema)) b: z.infer<typeof subSchema>, @CurrentPrincipal() p: UserPrincipal, @ClientIp() ip: string) {
    const data: Prisma.SubscriptionUpdateInput = {};
    if (b.planCode) {
      const plan = await this.prisma.plan.findUniqueOrThrow({ where: { code: b.planCode } });
      await this.billing.assertFits(id, plan);
      data.plan = { connect: { id: plan.id } };
    }
    if (b.status) data.status = b.status;
    if (b.currentPeriodEnd) data.currentPeriodEnd = new Date(b.currentPeriodEnd);
    if (b.status === 'ACTIVE') {
      data.graceEndsAt = null;
      data.provider = 'manual';
    }
    const sub = await this.prisma.subscription.update({ where: { organizationId: id }, data, include: { plan: true } });
    await this.audit.record(p, { action: 'admin.subscription_changed', organizationId: id, metadata: b, ip });
    return sub;
  }

  @Post('organizations/:orgId/domains/:id/suspension')
  @HttpCode(200)
  @ApiZodBody(domainAction)
  domainSuspension(@Param('orgId') orgId: string, @Param('id') id: string, @Body(new ZodPipe(domainAction)) b: z.infer<typeof domainAction>, @CurrentPrincipal() p: UserPrincipal, @ClientIp() ip: string) {
    return this.domains.setSuspended(p, orgId, id, b.suspended, b.reason, ip);
  }

  @Get('users')
  users(@Query(new ZodPipe(zPage)) q: z.infer<typeof zPage>) {
    return this.admin.listUsers(q);
  }

  @Post('users/:id/status')
  @HttpCode(200)
  @ApiZodBody(statusSchema)
  userStatus(@Param('id') id: string, @Body(new ZodPipe(statusSchema)) b: z.infer<typeof statusSchema>, @CurrentPrincipal() p: UserPrincipal, @ClientIp() ip: string) {
    return this.admin.setUserStatus(p, id, b.suspended, b.reason, ip);
  }

  @Post('users/:id/platform-role')
  @HttpCode(200)
  @ApiZodBody(roleSchema)
  platformRole(@Param('id') id: string, @Body(new ZodPipe(roleSchema)) b: z.infer<typeof roleSchema>, @CurrentPrincipal() p: UserPrincipal, @ClientIp() ip: string) {
    return this.admin.setPlatformRole(p, id, b.platformRole, ip);
  }

  @Get('domains')
  async allDomains(@Query(new ZodPipe(zPage)) q: z.infer<typeof zPage>) {
    const where: Prisma.DomainWhereInput = q.q ? { name: { contains: q.q.toLowerCase() } } : {};
    const [total, items] = await Promise.all([
      this.prisma.domain.count({ where }),
      this.prisma.domain.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { organization: { select: { id: true, name: true } }, _count: { select: { mailboxes: true } } } }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, items };
  }

  @Get('mailboxes')
  async allMailboxes(@Query(new ZodPipe(zPage.extend({ status: z.enum(['ACTIVE', 'SUSPENDED']).optional() }))) q: z.infer<typeof zPage> & { status?: 'ACTIVE' | 'SUSPENDED' }) {
    const where: Prisma.MailboxWhereInput = { status: q.status ?? { not: 'DELETED' }, ...(q.q ? { address: { contains: q.q.toLowerCase() } } : {}) };
    const [total, items] = await Promise.all([
      this.prisma.mailbox.count({ where }),
      this.prisma.mailbox.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: { id: true, address: true, displayName: true, status: true, quotaMb: true, usedBytes: true, suspendedReason: true, createdAt: true, organization: { select: { id: true, name: true } } },
      }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, items: items.map((i) => ({ ...i, usedBytes: Number(i.usedBytes) })) };
  }

  @Post('organizations/:orgId/mailboxes/:id/suspension')
  @HttpCode(200)
  @ApiZodBody(statusSchema)
  mailboxSuspension(@Param('orgId') orgId: string, @Param('id') id: string, @Body(new ZodPipe(statusSchema)) b: z.infer<typeof statusSchema>, @CurrentPrincipal() p: UserPrincipal, @ClientIp() ip: string) {
    return this.mailboxes.setSuspended(p, orgId, id, b.suspended, b.reason ?? 'Suspended by platform administrator', ip);
  }

  @Get('plans')
  plans() {
    return this.billing.plans(true);
  }

  @Post('plans')
  @ApiZodBody(planSchema)
  async createPlan(@Body(new ZodPipe(planSchema)) b: z.infer<typeof planSchema>, @CurrentPrincipal() p: UserPrincipal, @ClientIp() ip: string) {
    const plan = await this.prisma.plan.create({ data: b });
    await this.audit.record(p, { action: 'admin.plan_created', targetType: 'plan', targetId: plan.id, metadata: { code: b.code }, ip });
    return plan;
  }

  @Put('plans/:code')
  @ApiZodBody(planSchema.partial())
  async updatePlan(@Param('code') code: string, @Body(new ZodPipe(planSchema.partial())) b: Partial<z.infer<typeof planSchema>>, @CurrentPrincipal() p: UserPrincipal, @ClientIp() ip: string) {
    const plan = await this.prisma.plan.update({ where: { code }, data: b });
    await this.audit.record(p, { action: 'admin.plan_updated', targetType: 'plan', targetId: plan.id, metadata: b, ip });
    return plan;
  }

  @Get('audit')
  auditLogs(@Query(new ZodPipe(zPage.extend({ action: z.string().optional() }))) q: z.infer<typeof zPage> & { action?: string }) {
    return this.orgs.auditLogs(null, q);
  }

  @Get('security-events')
  securityEvents(@Query('unresolved') unresolved?: string) {
    return this.prisma.securityEvent.findMany({
      where: unresolved === '1' ? { resolvedAt: null } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { organization: { select: { id: true, name: true } } },
    });
  }

  @Post('security-events/:id/resolve')
  @HttpCode(200)
  async resolve(@Param('id') id: string, @CurrentPrincipal() p: UserPrincipal, @ClientIp() ip: string) {
    await this.prisma.securityEvent.update({ where: { id }, data: { resolvedAt: new Date() } });
    await this.audit.record(p, { action: 'admin.security_event_resolved', targetType: 'security_event', targetId: id, ip });
    return { ok: true };
  }

  @Get('delivery')
  delivery(@Query(new ZodPipe(daysQuery)) q: z.infer<typeof daysQuery>) {
    return this.orgs.deliveryStats(null, q.days);
  }

  @Get('queue')
  @ApiOperation({ summary: 'Outbound mail queue (live from the mail server)' })
  queue() {
    return this.stalwart.queueSummary(100);
  }

  @Get('monitoring')
  async monitoringInfo() {
    const [components, system, jobs] = await Promise.all([this.monitoring.components(), this.monitoring.system(), this.monitoring.jobs()]);
    return { components, system, jobs };
  }

  @Get('settings')
  settings() {
    return this.prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
  }

  @Put('settings/:key')
  @ApiZodBody(settingSchema)
  async setSetting(@Param('key') key: string, @Body(new ZodPipe(settingSchema)) b: z.infer<typeof settingSchema>, @CurrentPrincipal() p: UserPrincipal, @ClientIp() ip: string) {
    if (!/^[a-z0-9_.-]{2,60}$/.test(key)) throw new BadRequestException('Invalid key');
    const row = await this.prisma.systemSetting.upsert({ where: { key }, update: { value: b.value as Prisma.InputJsonValue }, create: { key, value: b.value as Prisma.InputJsonValue } });
    await this.audit.record(p, { action: 'admin.setting_changed', targetType: 'setting', targetId: key, ip });
    return row;
  }

  @Get('deliverability')
  @ApiOperation({ summary: 'Platform email deliverability readiness report' })
  async deliverability() {
    const cfg = loadConfig();
    const ptr = await this.domains.dns.checkPtr(cfg.MAIL_PUBLIC_IP, cfg.MAIL_HOSTNAME);
    const domains = await this.prisma.domain.findMany({ include: { dnsChecks: true, organization: { select: { name: true } } } });
    const health = await this.stalwart.health();
    return {
      mailHostname: cfg.MAIL_HOSTNAME,
      publicIp: cfg.MAIL_PUBLIC_IP ?? null,
      checks: [
        { name: 'Mail server reachable', status: health.ok ? 'PASS' : 'FAIL', detail: health.error ?? `${health.latencyMs} ms` },
        { name: 'Static public IP configured', status: cfg.MAIL_PUBLIC_IP ? 'PASS' : 'WARN', detail: cfg.MAIL_PUBLIC_IP ?? 'Set MAIL_PUBLIC_IP' },
        { name: 'Reverse DNS (PTR)', status: ptr.status, detail: ptr.message, found: ptr.found },
        { name: 'Outbound port 25', status: 'MANUAL', detail: 'Many cloud providers block port 25. Verify with: nc -vz gmail-smtp-in.l.google.com 25 from the server' },
        { name: 'TLS certificate', status: 'MANUAL', detail: `Verify with: openssl s_client -connect ${cfg.MAIL_HOSTNAME}:465 -servername ${cfg.MAIL_HOSTNAME}` },
      ],
      domains: domains.map((d) => ({
        name: d.name,
        organization: d.organization.name,
        status: d.status,
        failing: d.dnsChecks.filter((c) => c.required && c.status === 'FAIL').map((c) => c.kind),
        warnings: d.dnsChecks.filter((c) => c.status === 'WARN').map((c) => c.kind),
      })),
      note: 'Correct DNS and infrastructure improve deliverability but never guarantee inbox placement; IP and domain reputation build over time.',
    };
  }
}
