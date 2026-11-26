import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, NotFoundException, Param, Patch, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { API_KEY_SCOPES, ClientIp, CurrentPrincipal, OrgRoles, Public, Scopes } from '../../common/decorators';
import { AuditService } from '../../common/audit.service';
import { hashToken, randomToken } from '../../common/crypto';
import { JiRequest, Principal, UserPrincipal } from '../../common/principal';
import { PrismaService } from '../../common/prisma.service';
import { ApiZodBody, zEmail, ZodPipe, zPage, zPassword } from '../../common/zod';
import { BillingService } from '../billing/billing.service';
import { OrganizationsService } from './organizations.service';

const createOrg = z.object({ name: z.string().trim().min(2).max(100) });
const updateOrg = z.object({ name: z.string().trim().min(2).max(100).optional(), require2fa: z.boolean().optional() });
const roleEnum = z.enum(['OWNER', 'ADMIN', 'MAILBOX_ADMIN', 'MEMBER']);
const roleSchema = z.object({ role: roleEnum });
const inviteSchema = z.object({ email: zEmail, role: roleEnum });
const auditQuery = zPage.extend({ action: z.string().max(100).optional() });
const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(14) });
const apiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1),
  expiresInDays: z.number().int().min(1).max(730).optional(),
});
const planSchema = z.object({ planCode: z.string().min(1).max(50) });
const inviteRegister = z.object({ name: z.string().trim().min(1).max(100), password: zPassword });

@ApiTags('organizations')
@ApiBearerAuth()
@Controller()
export class OrganizationsController {
  constructor(
    private readonly orgs: OrganizationsService,
    private readonly billing: BillingService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('orgs')
  @ApiOperation({ summary: 'Organisations the current user belongs to' })
  mine(@CurrentPrincipal() p: UserPrincipal) {
    return this.orgs.mine(p);
  }

  @Post('orgs')
  @ApiZodBody(createOrg)
  create(@Body(new ZodPipe(createOrg)) body: z.infer<typeof createOrg>, @CurrentPrincipal() p: UserPrincipal, @ClientIp() ip: string) {
    return this.orgs.create(p, body.name, ip);
  }

  @Get('orgs/:orgId')
  @OrgRoles('MEMBER')
  @Scopes('organization:read')
  get(@Param('orgId') orgId: string) {
    return this.orgs.get(orgId);
  }

  @Patch('orgs/:orgId')
  @OrgRoles('ADMIN')
  @ApiZodBody(updateOrg)
  update(@Param('orgId') orgId: string, @Body(new ZodPipe(updateOrg)) body: z.infer<typeof updateOrg>, @CurrentPrincipal() p: Principal, @Req() req: JiRequest) {
    return this.orgs.update(p, req, orgId, body);
  }

  @Get('orgs/:orgId/dashboard')
  @OrgRoles('MAILBOX_ADMIN')
  @Scopes('organization:read')
  dashboard(@Param('orgId') orgId: string) {
    return this.orgs.dashboard(orgId);
  }

  @Get('orgs/:orgId/usage')
  @OrgRoles('MAILBOX_ADMIN')
  @Scopes('usage:read')
  usage(@Param('orgId') orgId: string) {
    return this.orgs.usage(orgId);
  }

  @Get('orgs/:orgId/delivery')
  @OrgRoles('MAILBOX_ADMIN')
  @Scopes('delivery:read')
  @ApiOperation({ summary: 'Delivery statistics (delivered, failed, bounces, spam) from mail server events' })
  delivery(@Param('orgId') orgId: string, @Query(new ZodPipe(daysQuery)) q: z.infer<typeof daysQuery>) {
    return this.orgs.deliveryStats(orgId, q.days);
  }

  @Get('orgs/:orgId/audit')
  @OrgRoles('ADMIN')
  auditLogs(@Param('orgId') orgId: string, @Query(new ZodPipe(auditQuery)) q: z.infer<typeof auditQuery>) {
    return this.orgs.auditLogs(orgId, q);
  }

  @Get('orgs/:orgId/security-events')
  @OrgRoles('ADMIN')
  securityEvents(@Param('orgId') orgId: string) {
    return this.prisma.securityEvent.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  // ─── Members ───

  @Get('orgs/:orgId/members')
  @OrgRoles('MAILBOX_ADMIN')
  members(@Param('orgId') orgId: string) {
    return this.orgs.members(orgId);
  }

  @Patch('orgs/:orgId/members/:userId')
  @OrgRoles('ADMIN')
  @ApiZodBody(roleSchema)
  changeRole(@Param('orgId') orgId: string, @Param('userId') userId: string, @Body(new ZodPipe(roleSchema)) body: z.infer<typeof roleSchema>, @CurrentPrincipal() p: Principal, @Req() req: JiRequest) {
    return this.orgs.changeRole(p, req, orgId, userId, body.role);
  }

  @Delete('orgs/:orgId/members/:userId')
  @OrgRoles('ADMIN')
  removeMember(@Param('orgId') orgId: string, @Param('userId') userId: string, @CurrentPrincipal() p: Principal, @Req() req: JiRequest) {
    return this.orgs.removeMember(p, req, orgId, userId);
  }

  @Get('orgs/:orgId/invitations')
  @OrgRoles('ADMIN')
  invitations(@Param('orgId') orgId: string) {
    return this.orgs.invitations(orgId);
  }

  @Post('orgs/:orgId/invitations')
  @OrgRoles('ADMIN')
  @ApiZodBody(inviteSchema)
  invite(@Param('orgId') orgId: string, @Body(new ZodPipe(inviteSchema)) body: z.infer<typeof inviteSchema>, @CurrentPrincipal() p: UserPrincipal, @Req() req: JiRequest) {
    return this.orgs.invite(p, req, orgId, body.email, body.role);
  }

  @Delete('orgs/:orgId/invitations/:id')
  @OrgRoles('ADMIN')
  revokeInvitation(@Param('orgId') orgId: string, @Param('id') id: string, @CurrentPrincipal() p: Principal, @Req() req: JiRequest) {
    return this.orgs.revokeInvitation(p, req, orgId, id);
  }

  @Public()
  @Get('invitations/:token')
  async invitation(@Param('token') token: string) {
    const { inv: _inv, ...rest } = await this.orgs.invitationByToken(token);
    return rest;
  }

  @Post('invitations/:token/accept')
  @HttpCode(200)
  accept(@Param('token') token: string, @CurrentPrincipal() p: UserPrincipal, @ClientIp() ip: string) {
    return this.orgs.accept(token, p, ip);
  }

  @Public()
  @Post('invitations/:token/register')
  @ApiZodBody(inviteRegister)
  registerWithInvite(@Param('token') token: string, @Body(new ZodPipe(inviteRegister)) body: z.infer<typeof inviteRegister>, @ClientIp() ip: string) {
    return this.orgs.registerWithInvite(token, body.name, body.password, ip);
  }

  // ─── API keys ───

  @Get('orgs/:orgId/api-keys')
  @OrgRoles('ADMIN')
  apiKeys(@Param('orgId') orgId: string) {
    return this.prisma.apiKey.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, lastUsedIp: true, expiresAt: true, revokedAt: true, createdAt: true, createdBy: { select: { name: true, email: true } } },
    });
  }

  @Post('orgs/:orgId/api-keys')
  @OrgRoles('ADMIN')
  @ApiZodBody(apiKeySchema)
  @ApiOperation({ summary: 'Create an API key. The secret is shown once.' })
  async createApiKey(@Param('orgId') orgId: string, @Body(new ZodPipe(apiKeySchema)) body: z.infer<typeof apiKeySchema>, @CurrentPrincipal() p: UserPrincipal, @ClientIp() ip: string) {
    const count = await this.prisma.apiKey.count({ where: { organizationId: orgId, revokedAt: null } });
    if (count >= 25) throw new BadRequestException('At most 25 active API keys per organisation');
    const secret = `jm_live_${randomToken(30)}`;
    const key = await this.prisma.apiKey.create({
      data: {
        organizationId: orgId,
        name: body.name,
        scopes: body.scopes,
        prefix: secret.slice(0, 14),
        keyHash: hashToken(secret),
        createdById: p.userId,
        expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86400_000) : null,
      },
    });
    await this.audit.record(p, { action: 'api_key.created', organizationId: orgId, targetType: 'api_key', targetId: key.id, metadata: { name: body.name, scopes: body.scopes }, ip });
    return { id: key.id, name: key.name, scopes: key.scopes, prefix: key.prefix, expiresAt: key.expiresAt, secret };
  }

  @Post('orgs/:orgId/api-keys/:id/rotate')
  @OrgRoles('ADMIN')
  @ApiOperation({ summary: 'Rotate a key: revokes it and issues a replacement with the same scopes' })
  async rotate(@Param('orgId') orgId: string, @Param('id') id: string, @CurrentPrincipal() p: UserPrincipal, @ClientIp() ip: string) {
    const old = await this.prisma.apiKey.findFirst({ where: { id, organizationId: orgId, revokedAt: null } });
    if (!old) throw new NotFoundException('API key not found');
    const secret = `jm_live_${randomToken(30)}`;
    const [, key] = await this.prisma.$transaction([
      this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } }),
      this.prisma.apiKey.create({
        data: { organizationId: orgId, name: old.name, scopes: old.scopes, prefix: secret.slice(0, 14), keyHash: hashToken(secret), createdById: p.userId, expiresAt: old.expiresAt },
      }),
    ]);
    await this.audit.record(p, { action: 'api_key.rotated', organizationId: orgId, targetType: 'api_key', targetId: key.id, metadata: { replaced: id }, ip });
    return { id: key.id, name: key.name, scopes: key.scopes, prefix: key.prefix, expiresAt: key.expiresAt, secret };
  }

  @Delete('orgs/:orgId/api-keys/:id')
  @OrgRoles('ADMIN')
  async revokeKey(@Param('orgId') orgId: string, @Param('id') id: string, @CurrentPrincipal() p: Principal, @ClientIp() ip: string) {
    const r = await this.prisma.apiKey.updateMany({ where: { id, organizationId: orgId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw new NotFoundException('API key not found');
    await this.audit.record(p, { action: 'api_key.revoked', organizationId: orgId, targetType: 'api_key', targetId: id, ip });
    return { ok: true };
  }

  // ─── Billing ───

  @Public()
  @Get('plans')
  plans() {
    return this.billing.plans();
  }

  @Get('orgs/:orgId/billing')
  @OrgRoles('ADMIN')
  billingOverview(@Param('orgId') orgId: string) {
    return this.billing.overview(orgId);
  }

  @Post('orgs/:orgId/billing/plan')
  @HttpCode(200)
  @OrgRoles('OWNER')
  @ApiZodBody(planSchema)
  async changePlan(@Param('orgId') orgId: string, @Body(new ZodPipe(planSchema)) body: z.infer<typeof planSchema>, @CurrentPrincipal() p: Principal, @ClientIp() ip: string) {
    const r = await this.billing.changePlan(orgId, body.planCode, { admin: p.kind === 'user' && p.platformRole === 'SUPER_ADMIN' });
    await this.audit.record(p, { action: 'billing.plan_change_requested', organizationId: orgId, metadata: { planCode: body.planCode }, ip });
    return r;
  }

  @Post('orgs/:orgId/billing/checkout')
  @HttpCode(200)
  @OrgRoles('OWNER')
  @ApiZodBody(planSchema)
  checkout(@Param('orgId') orgId: string, @Body(new ZodPipe(planSchema)) body: z.infer<typeof planSchema>) {
    return this.billing.createCheckout(orgId, body.planCode);
  }

  @Post('orgs/:orgId/billing/portal')
  @HttpCode(200)
  @OrgRoles('OWNER')
  portal(@Param('orgId') orgId: string) {
    return this.billing.createPortal(orgId);
  }

  @Public()
  @Post('billing/stripe/webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Stripe webhook receiver (signature verified)' })
  async stripeWebhook(@Req() req: JiRequest & { rawBody?: Buffer }, @Headers('stripe-signature') sig?: string) {
    if (!req.rawBody || !this.billing.verifyStripeSignature(req.rawBody, sig)) throw new UnauthorizedException('Invalid signature');
    return this.billing.handleStripeEvent(JSON.parse(req.rawBody.toString('utf8')));
  }
}
