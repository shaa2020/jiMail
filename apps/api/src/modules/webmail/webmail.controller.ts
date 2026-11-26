import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { CurrentPrincipal } from '../../common/decorators';
import { UploadedFileData, UserPrincipal } from '../../common/principal';
import { ApiZodBody, zEmail, ZodPipe } from '../../common/zod';
import { PREVIEWABLE } from './sanitize';
import { WebmailService } from './webmail.service';

const bool = z.union([z.boolean(), z.enum(['true', 'false', '1', '0'])]).transform((v) => v === true || v === 'true' || v === '1');
const listSchema = z.object({
  folderId: z.string().max(100).optional(),
  q: z.string().max(200).optional(),
  from: z.string().max(200).optional(),
  to: z.string().max(200).optional(),
  subject: z.string().max(200).optional(),
  after: z.string().max(40).optional(),
  before: z.string().max(40).optional(),
  hasAttachment: bool.optional(),
  starred: bool.optional(),
  unread: bool.optional(),
  position: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const ids = z.array(z.string().min(1).max(100)).min(1).max(500);
const keywordsSchema = z.object({ ids, seen: z.boolean().optional(), flagged: z.boolean().optional() });
const moveSchema = z.object({ ids, folderId: z.string().optional(), role: z.enum(['archive', 'trash', 'junk', 'inbox']).optional() });
const idsSchema = z.object({ ids });
const address = z.object({ name: z.string().max(200).nullish(), email: zEmail });
const composeSchema = z.object({
  identityId: z.string().optional(),
  to: z.array(address).max(100).default([]),
  cc: z.array(address).max(100).default([]),
  bcc: z.array(address).max(100).default([]),
  subject: z.string().max(998).default(''),
  html: z.string().max(5_000_000).optional(),
  text: z.string().max(5_000_000).optional(),
  attachments: z.array(z.object({ blobId: z.string().min(1), name: z.string().max(255), type: z.string().max(255), size: z.number().optional() })).max(50).default([]),
  inReplyToId: z.string().optional(),
  draftId: z.string().optional(),
});
const folderSchema = z.object({ name: z.string().trim().min(1).max(255), parentId: z.string().nullable().default(null) });
const renameSchema = z.object({ name: z.string().trim().min(1).max(255) });
const identitySchema = z.object({ name: z.string().max(200).optional(), textSignature: z.string().max(10000).optional(), htmlSignature: z.string().max(50000).optional() });
const vacationSchema = z.object({
  isEnabled: z.boolean(),
  fromDate: z.string().datetime({ offset: true }).nullish(),
  toDate: z.string().datetime({ offset: true }).nullish(),
  subject: z.string().max(998).nullish(),
  textBody: z.string().max(20000).nullish(),
  htmlBody: z.string().max(50000).nullish(),
});
const contactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: zEmail.nullish(),
  phone: z.string().max(50).nullish(),
  company: z.string().max(200).nullish(),
  notes: z.string().max(5000).nullish(),
});

/** Webmail for mailboxes the signed-in user has been granted. Personal (non-tenant) routes: authorised per mailbox. */
@ApiTags('webmail')
@Controller('webmail')
export class WebmailController {
  constructor(private readonly mail: WebmailService) {}

  @Get('mailboxes')
  accessible(@CurrentPrincipal() p: UserPrincipal) {
    return this.mail.accessible(p);
  }

  @Get(':mb/folders')
  async folders(@CurrentPrincipal() p: UserPrincipal, @Param('mb') mb: string) {
    return this.mail.folders(await this.mail.ctx(p, mb));
  }

  @Post(':mb/folders')
  @ApiZodBody(folderSchema)
  async createFolder(@CurrentPrincipal() p: UserPrincipal, @Param('mb') mb: string, @Body(new ZodPipe(folderSchema)) b: z.infer<typeof folderSchema>) {
    return this.mail.createFolder(await this.mail.ctx(p, mb), b.name, b.parentId);
  }

  @Patch(':mb/folders/:id')
  @ApiZodBody(renameSchema)
  async renameFolder(@CurrentPrincipal() p: UserPrincipal, @Param('mb') mb: string, @Param('id') id: string, @Body(new ZodPipe(renameSchema)) b: z.infer<typeof renameSchema>) {
    return this.mail.renameFolder(await this.mail.ctx(p, mb), id, b.name);
  }

  @Delete(':mb/folders/:id')
  async deleteFolder(@CurrentPrincipal() p: UserPrincipal, @Param('mb') mb: string, @Param('id') id: string) {
    return this.mail.deleteFolder(await this.mail.ctx(p, mb), id);
  }

  @Get(':mb/messages')
  async list(@CurrentPrincipal() p: UserPrincipal, @Param('mb') mb: string, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.mail.list(await this.mail.ctx(p, mb), q);
  }

  @Get(':mb/messages/:id')
  async get(@CurrentPrincipal() p: UserPrincipal, @Param('mb') mb: string, @Param('id') id: string, @Query('remoteImages') remote?: string) {
    return this.mail.get(await this.mail.ctx(p, mb), id, remote === '1' || remote === 'true');
  }

  @Post(':mb/messages/keywords')
  @HttpCode(200)
  @ApiZodBody(keywordsSchema)
  async keywords(@CurrentPrincipal() p: UserPrincipal, @Param('mb') mb: string, @Body(new ZodPipe(keywordsSchema)) b: z.infer<typeof keywordsSchema>) {
    const kw: Record<string, boolean> = {};
    if (b.seen !== undefined) kw.$seen = b.seen;
    if (b.flagged !== undefined) kw.$flagged = b.flagged;
    if (!Object.keys(kw).length) throw new BadRequestException('Nothing to change');
    return this.mail.setKeywords(await this.mail.ctx(p, mb), b.ids, kw);
  }

  @Post(':mb/messages/move')
  @HttpCode(200)
  @ApiZodBody(moveSchema)
  async move(@CurrentPrincipal() p: UserPrincipal, @Param('mb') mb: string, @Body(new ZodPipe(moveSchema)) b: z.infer<typeof moveSchema>) {
    const c = await this.mail.ctx(p, mb);
    if (b.role) return this.mail.moveToRole(c, b.ids, b.role);
    if (!b.folderId) throw new BadRequestException('folderId or role is required');
    return this.mail.move(c, b.ids, b.folderId);
  }

  @Post(':mb/messages/delete')
  @HttpCode(200)
  @ApiZodBody(idsSchema)
  async remove(@CurrentPrincipal() p: UserPrincipal, @Param('mb') mb: string, @Body(new ZodPipe(idsSchema)) b: z.infer<typeof idsSchema>) {
    return this.mail.remove(await this.mail.ctx(p, mb), b.ids);
  }

  @Post(':mb/send')
  @HttpCode(200)
  @ApiZodBody(composeSchema)
  async send(@CurrentPrincipal() p: UserPrincipal, @Param('mb') mb: string, @Body(new ZodPipe(composeSchema)) b: z.infer<typeof composeSchema>) {
    return this.mail.send(await this.mail.ctx(p, mb), b);
  }

  @Put(':mb/drafts')
  @ApiZodBody(composeSchema)
  async draft(@CurrentPrincipal() p: UserPrincipal, @Param('mb') mb: string, @Body(new ZodPipe(composeSchema)) b: z.infer<typeof composeSchema>) {
    return this.mail.saveDraft(await this.mail.ctx(p, mb), b);
  }

  @Post(':mb/blobs')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async upload(@CurrentPrincipal() p: UserPrincipal, @Param('mb') mb: string, @UploadedFile() file?: UploadedFileData) {
    if (!file) throw new BadRequestException('No file uploaded');
    const r = await this.mail.upload(await this.mail.ctx(p, mb), file.buffer, file.mimetype);
    return { blobId: r.blobId, size: r.size, type: file.mimetype, name: file.originalname };
  }

  /**
   * Streams an attachment. Only a small allow-list of types is ever served inline; everything else is a
   * download with nosniff, so attachments cannot execute in the application origin.
   */
  @Get(':mb/blobs/:blobId')
  async download(
    @CurrentPrincipal() p: UserPrincipal,
    @Param('mb') mb: string,
    @Param('blobId') blobId: string,
    @Query('name') name = 'attachment',
    @Query('type') type = 'application/octet-stream',
    @Query('inline') inline: string | undefined,
    @Res() res: Response,
  ) {
    const upstream = await this.mail.download(await this.mail.ctx(p, mb), blobId);
    const safeName = name.replace(/[\r\n"\\]/g, '_').slice(0, 200);
    const canInline = inline === '1' && PREVIEWABLE.has(type);
    res.setHeader('Content-Type', canInline ? type : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${canInline ? 'inline' : 'attachment'}; filename="${safeName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(safeName)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=300');
    const len = upstream.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);
    Readable.fromWeb(upstream.body as any).pipe(res);
  }

  @Get(':mb/identities')
  async identities(@CurrentPrincipal() p: UserPrincipal, @Param('mb') mb: string) {
    return this.mail.identities(await this.mail.ctx(p, mb));
  }

  @Patch(':mb/identities/:id')
  @ApiZodBody(identitySchema)
  async updateIdentity(@CurrentPrincipal() p: UserPrincipal, @Param('mb') mb: string, @Param('id') id: string, @Body(new ZodPipe(identitySchema)) b: z.infer<typeof identitySchema>) {
    return this.mail.updateIdentity(await this.mail.ctx(p, mb), id, b);
  }

  @Get(':mb/vacation')
  async vacation(@CurrentPrincipal() p: UserPrincipal, @Param('mb') mb: string) {
    return this.mail.vacation(await this.mail.ctx(p, mb));
  }

  @Put(':mb/vacation')
  @ApiZodBody(vacationSchema)
  async setVacation(@CurrentPrincipal() p: UserPrincipal, @Param('mb') mb: string, @Body(new ZodPipe(vacationSchema)) b: z.infer<typeof vacationSchema>) {
    return this.mail.setVacation(await this.mail.ctx(p, mb), b);
  }

  @Get(':mb/contacts')
  async contacts(@CurrentPrincipal() p: UserPrincipal, @Param('mb') mb: string, @Query('q') q?: string) {
    return this.mail.contacts(await this.mail.ctx(p, mb), q?.slice(0, 100));
  }

  @Post(':mb/contacts')
  @ApiZodBody(contactSchema)
  async createContact(@CurrentPrincipal() p: UserPrincipal, @Param('mb') mb: string, @Body(new ZodPipe(contactSchema)) b: z.infer<typeof contactSchema>) {
    return this.mail.createContact(await this.mail.ctx(p, mb), b);
  }

  @Put(':mb/contacts/:id')
  @ApiZodBody(contactSchema)
  async updateContact(@CurrentPrincipal() p: UserPrincipal, @Param('mb') mb: string, @Param('id') id: string, @Body(new ZodPipe(contactSchema)) b: z.infer<typeof contactSchema>) {
    return this.mail.updateContact(await this.mail.ctx(p, mb), id, b);
  }

  @Delete(':mb/contacts/:id')
  async deleteContact(@CurrentPrincipal() p: UserPrincipal, @Param('mb') mb: string, @Param('id') id: string) {
    return this.mail.deleteContact(await this.mail.ctx(p, mb), id);
  }

  @Get(':mb/suggest')
  async suggest(@CurrentPrincipal() p: UserPrincipal, @Param('mb') mb: string, @Query('q') q = '') {
    if (q.trim().length < 2) return [];
    return this.mail.suggest(await this.mail.ctx(p, mb), q.trim().slice(0, 100));
  }

  @Get(':mb/quota')
  async quota(@CurrentPrincipal() p: UserPrincipal, @Param('mb') mb: string) {
    return this.mail.quota(await this.mail.ctx(p, mb));
  }
}
