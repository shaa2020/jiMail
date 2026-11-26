import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ClientIp, CurrentPrincipal, OrgRoles, Scopes } from '../../common/decorators';
import { Principal, UploadedFileData } from '../../common/principal';
import { PrismaService } from '../../common/prisma.service';
import { ApiZodBody, ApiZodQuery, zEmail, ZodPipe, zPage } from '../../common/zod';
import { MailboxesService } from './mailboxes.service';

const createSchema = z.object({
  domainId: z.string().min(1),
  localPart: z.string().min(1).max(64),
  displayName: z.string().trim().min(1).max(100),
  password: z.string().max(256).optional(),
  generatePassword: z.boolean().optional(),
  quotaMb: z.number().int().min(50).max(1048576).optional(),
});
const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(100).optional(),
  quotaMb: z.number().int().min(50).max(1048576).optional(),
  sendLimitPerHour: z.number().int().min(1).max(100000).nullable().optional(),
});
const listSchema = zPage.extend({ domainId: z.string().optional(), status: z.enum(['ACTIVE', 'SUSPENDED']).optional() });
const pwSchema = z.object({ password: z.string().max(256).optional() });
const suspendSchema = z.object({ reason: z.string().max(500).optional() });
const deleteSchema = z.object({ confirmAddress: z.string().min(3) });
const aliasSchema = z.object({ localPart: z.string().min(1).max(64), domainId: z.string().min(1) });
const forwardSchema = z.object({ addresses: z.array(zEmail).max(10), keepCopy: z.boolean().default(true) });
const accessSchema = z.object({ userId: z.string().min(1) });

@ApiTags('mailboxes')
@ApiBearerAuth()
@Controller('orgs/:orgId/mailboxes')
export class MailboxesController {
  constructor(
    private readonly mailboxes: MailboxesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @OrgRoles('MAILBOX_ADMIN')
  @Scopes('mailboxes:read', 'mailboxes:write')
  @ApiZodQuery(listSchema)
  list(@Param('orgId') orgId: string, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.mailboxes.list(orgId, q);
  }

  @Post()
  @OrgRoles('MAILBOX_ADMIN')
  @Scopes('mailboxes:write')
  @ApiZodBody(createSchema)
  @ApiOperation({ summary: 'Create a mailbox. A generated temporary password is returned once and never logged.' })
  create(@Param('orgId') orgId: string, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>, @CurrentPrincipal() p: Principal, @ClientIp() ip: string) {
    return this.mailboxes.create(p, orgId, body, ip);
  }

  @Post('import')
  @OrgRoles('MAILBOX_ADMIN')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024 } }))
  @ApiOperation({ summary: 'Bulk-create mailboxes from CSV (columns: address,name,quota_mb,password)' })
  import(@Param('orgId') orgId: string, @UploadedFile() file: UploadedFileData | undefined, @Body('csv') csvText: string | undefined, @CurrentPrincipal() p: Principal, @ClientIp() ip: string) {
    const csv = file ? file.buffer.toString('utf8') : (csvText ?? '');
    return this.mailboxes.importCsv(p, orgId, csv, ip);
  }

  @Get(':id')
  @OrgRoles('MAILBOX_ADMIN')
  @Scopes('mailboxes:read', 'mailboxes:write')
  get(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.mailboxes.get(orgId, id);
  }

  @Get(':id/connection')
  @OrgRoles('MAILBOX_ADMIN')
  @Scopes('mailboxes:read')
  async connection(@Param('orgId') orgId: string, @Param('id') id: string) {
    const m = await this.mailboxes.get(orgId, id);
    return this.mailboxes.connectionSettings(m.address);
  }

  @Patch(':id')
  @OrgRoles('MAILBOX_ADMIN')
  @Scopes('mailboxes:write')
  @ApiZodBody(updateSchema)
  update(@Param('orgId') orgId: string, @Param('id') id: string, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>, @CurrentPrincipal() p: Principal, @ClientIp() ip: string) {
    return this.mailboxes.update(p, orgId, id, body, ip);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @OrgRoles('MAILBOX_ADMIN')
  @Scopes('mailboxes:write')
  @ApiZodBody(pwSchema)
  resetPassword(@Param('orgId') orgId: string, @Param('id') id: string, @Body(new ZodPipe(pwSchema)) body: z.infer<typeof pwSchema>, @CurrentPrincipal() p: Principal, @ClientIp() ip: string) {
    return this.mailboxes.resetPassword(p, orgId, id, body.password || undefined, ip);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @OrgRoles('MAILBOX_ADMIN')
  @Scopes('mailboxes:write')
  @ApiZodBody(suspendSchema)
  suspend(@Param('orgId') orgId: string, @Param('id') id: string, @Body(new ZodPipe(suspendSchema)) body: z.infer<typeof suspendSchema>, @CurrentPrincipal() p: Principal, @ClientIp() ip: string) {
    return this.mailboxes.setSuspended(p, orgId, id, true, body.reason, ip);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @OrgRoles('MAILBOX_ADMIN')
  @Scopes('mailboxes:write')
  reactivate(@Param('orgId') orgId: string, @Param('id') id: string, @CurrentPrincipal() p: Principal, @ClientIp() ip: string) {
    return this.mailboxes.setSuspended(p, orgId, id, false, undefined, ip);
  }

  @Delete(':id')
  @OrgRoles('ADMIN')
  @Scopes('mailboxes:write')
  @ApiZodBody(deleteSchema)
  @ApiOperation({ summary: 'Permanently delete a mailbox and its mail. Requires confirmAddress.' })
  remove(@Param('orgId') orgId: string, @Param('id') id: string, @Body(new ZodPipe(deleteSchema)) body: z.infer<typeof deleteSchema>, @CurrentPrincipal() p: Principal, @ClientIp() ip: string) {
    return this.mailboxes.remove(p, orgId, id, body.confirmAddress, ip);
  }

  @Post(':id/aliases')
  @OrgRoles('MAILBOX_ADMIN')
  @Scopes('aliases:write')
  @ApiZodBody(aliasSchema)
  addAlias(@Param('orgId') orgId: string, @Param('id') id: string, @Body(new ZodPipe(aliasSchema)) body: z.infer<typeof aliasSchema>, @CurrentPrincipal() p: Principal, @ClientIp() ip: string) {
    return this.mailboxes.addAlias(p, orgId, id, body, ip);
  }

  @Delete(':id/aliases/:aliasId')
  @OrgRoles('MAILBOX_ADMIN')
  @Scopes('aliases:write')
  removeAlias(@Param('orgId') orgId: string, @Param('id') id: string, @Param('aliasId') aliasId: string, @CurrentPrincipal() p: Principal, @ClientIp() ip: string) {
    return this.mailboxes.removeAlias(p, orgId, id, aliasId, ip);
  }

  @Put(':id/forwarding')
  @OrgRoles('MAILBOX_ADMIN')
  @Scopes('mailboxes:write')
  @ApiZodBody(forwardSchema)
  forwarding(@Param('orgId') orgId: string, @Param('id') id: string, @Body(new ZodPipe(forwardSchema)) body: z.infer<typeof forwardSchema>, @CurrentPrincipal() p: Principal, @ClientIp() ip: string) {
    return this.mailboxes.setForwarding(p, orgId, id, body.addresses, body.keepCopy, ip);
  }

  @Get(':id/access')
  @OrgRoles('ADMIN')
  async access(@Param('orgId') orgId: string, @Param('id') id: string) {
    await this.mailboxes.get(orgId, id);
    return this.prisma.mailboxAccess.findMany({ where: { mailboxId: id }, include: { user: { select: { id: true, email: true, name: true } } } });
  }

  @Post(':id/access')
  @OrgRoles('ADMIN')
  @ApiZodBody(accessSchema)
  @ApiOperation({ summary: 'Grant an organisation member webmail access to this mailbox (shared mailbox)' })
  async grant(@Param('orgId') orgId: string, @Param('id') id: string, @Body(new ZodPipe(accessSchema)) body: z.infer<typeof accessSchema>) {
    await this.mailboxes.get(orgId, id);
    const member = await this.prisma.membership.findUnique({ where: { userId_organizationId: { userId: body.userId, organizationId: orgId } } });
    if (!member) throw new NotFoundException('User is not a member of this organisation');
    return this.prisma.mailboxAccess.upsert({ where: { userId_mailboxId: { userId: body.userId, mailboxId: id } }, update: {}, create: { userId: body.userId, mailboxId: id } });
  }

  @Delete(':id/access/:userId')
  @OrgRoles('ADMIN')
  async revoke(@Param('orgId') orgId: string, @Param('id') id: string, @Param('userId') userId: string) {
    await this.mailboxes.get(orgId, id);
    await this.prisma.mailboxAccess.deleteMany({ where: { mailboxId: id, userId } });
    return { ok: true };
  }

  @Post('sync-usage')
  @HttpCode(200)
  @OrgRoles('MAILBOX_ADMIN')
  @Scopes('usage:read')
  syncUsage(@Param('orgId') orgId: string) {
    return this.mailboxes.syncUsage(orgId);
  }
}
