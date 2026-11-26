import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { decrypt } from '../../common/crypto';
import { PrismaService } from '../../common/prisma.service';
import { UserPrincipal } from '../../common/principal';
import { RateLimitService } from '../../common/rate-limit.service';
import { CONTACTS, CORE, MAIL, MethodCall, StalwartClient, StalwartError, SUBMISSION, VACATION } from '../stalwart/stalwart.client';
import { attachmentRisk, PREVIEWABLE, sanitizeEmailHtml, textToHtml } from './sanitize';

export interface MailCtx {
  mailboxId: string;
  address: string;
  displayName: string;
  organizationId: string;
  key: string;
  accountId: string;
  sendLimitPerHour: number;
}

const SUMMARY_PROPS = ['id', 'threadId', 'mailboxIds', 'keywords', 'from', 'to', 'cc', 'subject', 'preview', 'receivedAt', 'sentAt', 'hasAttachment', 'size'];
const FULL_PROPS = [...SUMMARY_PROPS, 'bcc', 'replyTo', 'messageId', 'inReplyTo', 'references', 'textBody', 'htmlBody', 'attachments', 'bodyValues'];

export interface ListQuery {
  folderId?: string;
  q?: string;
  from?: string;
  to?: string;
  subject?: string;
  after?: string;
  before?: string;
  hasAttachment?: boolean;
  starred?: boolean;
  unread?: boolean;
  position: number;
  limit: number;
}

export interface Address {
  name?: string | null;
  email: string;
}

export interface ComposeInput {
  identityId?: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  html?: string;
  text?: string;
  attachments: { blobId: string; name: string; type: string; size?: number }[];
  inReplyToId?: string;
  draftId?: string;
}

@Injectable()
export class WebmailService {
  private readonly accountCache = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly stalwart: StalwartClient,
    private readonly rl: RateLimitService,
  ) {}

  /** Mailboxes the signed-in user may open in webmail. */
  async accessible(p: UserPrincipal) {
    const rows = await this.prisma.mailboxAccess.findMany({
      where: { userId: p.userId, mailbox: { status: { not: 'DELETED' } } },
      include: { mailbox: { select: { id: true, address: true, displayName: true, status: true, quotaMb: true, usedBytes: true, organizationId: true } } },
    });
    return rows.map((r) => ({ ...r.mailbox, usedBytes: Number(r.mailbox.usedBytes) }));
  }

  /** Authorises access and returns the server-side JMAP context for the mailbox. */
  async ctx(p: UserPrincipal, mailboxId: string): Promise<MailCtx> {
    const access = await this.prisma.mailboxAccess.findUnique({
      where: { userId_mailboxId: { userId: p.userId, mailboxId } },
      include: { mailbox: { include: { organization: { include: { subscription: { include: { plan: true } } } } } } },
    });
    if (!access) throw new NotFoundException('Mailbox not found');
    const mb = access.mailbox;
    if (mb.status === 'DELETED') throw new NotFoundException('Mailbox not found');
    if (mb.status === 'SUSPENDED') throw new ForbiddenException(mb.suspendedReason ?? 'This mailbox is suspended');
    if (mb.organization.status !== 'ACTIVE') throw new ForbiddenException('This organisation is suspended');
    if (!mb.serviceKeyEnc) throw new BadRequestException('Mailbox is not ready for webmail');
    const key = decrypt(mb.serviceKeyEnc);
    let accountId = this.accountCache.get(mb.id);
    if (!accountId) {
      accountId = await this.stalwart.mailboxAccountId(key);
      this.accountCache.set(mb.id, accountId);
    }
    const sendLimitPerHour = mb.sendLimitPerHour ?? mb.organization.sendLimitPerHourOverride ?? mb.organization.subscription?.plan.sendLimitPerHour ?? 100;
    return { mailboxId: mb.id, address: mb.address, displayName: mb.displayName, organizationId: mb.organizationId, key, accountId, sendLimitPerHour };
  }

  private call(c: MailCtx, calls: MethodCall[], using = [CORE, MAIL, SUBMISSION]) {
    return this.stalwart.mailbox(c.key, calls, using);
  }

  // ───────────── Folders ─────────────

  async folders(c: MailCtx) {
    const [[, r]] = await this.call(c, [['Mailbox/get', { accountId: c.accountId, properties: ['name', 'role', 'parentId', 'sortOrder', 'totalEmails', 'unreadEmails', 'totalThreads', 'unreadThreads'] }, 'f']]);
    let list = r.list as any[];
    if (!list.some((m) => m.role === 'archive')) {
      // JiMail's Archive folder is created on first use with the standard "archive" role.
      await this.call(c, [['Mailbox/set', { accountId: c.accountId, create: { a: { name: 'Archive', role: 'archive', parentId: null } } }, 's']]);
      const [[, again]] = await this.call(c, [['Mailbox/get', { accountId: c.accountId, properties: ['name', 'role', 'parentId', 'sortOrder', 'totalEmails', 'unreadEmails', 'totalThreads', 'unreadThreads'] }, 'f']]);
      list = again.list;
    }
    const order: Record<string, number> = { inbox: 0, drafts: 1, sent: 2, archive: 3, junk: 4, trash: 5 };
    return list.sort((a, b) => (order[a.role] ?? 10) - (order[b.role] ?? 10) || String(a.name).localeCompare(String(b.name)));
  }

  private async roleId(c: MailCtx, role: string): Promise<string> {
    const f = (await this.folders(c)).find((m) => m.role === role);
    if (!f) throw new BadRequestException(`Folder with role ${role} is missing`);
    return f.id;
  }

  async createFolder(c: MailCtx, name: string, parentId: string | null) {
    const [[, r]] = await this.call(c, [['Mailbox/set', { accountId: c.accountId, create: { n: { name, parentId } } }, 's']]);
    if (r.notCreated?.n) throw new BadRequestException(r.notCreated.n.description ?? 'Could not create folder');
    return r.created.n;
  }

  async renameFolder(c: MailCtx, id: string, name: string) {
    const [[, r]] = await this.call(c, [['Mailbox/set', { accountId: c.accountId, update: { [id]: { name } } }, 's']]);
    if (r.notUpdated?.[id]) throw new BadRequestException(r.notUpdated[id].description ?? 'Could not rename folder');
    return { ok: true };
  }

  async deleteFolder(c: MailCtx, id: string) {
    const f = (await this.folders(c)).find((m) => m.id === id);
    if (!f) throw new NotFoundException('Folder not found');
    if (f.role) throw new BadRequestException('System folders cannot be deleted');
    const [[, r]] = await this.call(c, [['Mailbox/set', { accountId: c.accountId, destroy: [id], onDestroyRemoveEmails: false }, 's']]);
    if (r.notDestroyed?.[id]) throw new BadRequestException(r.notDestroyed[id].type === 'mailboxHasEmail' ? 'Move or delete the messages in this folder first' : (r.notDestroyed[id].description ?? 'Could not delete folder'));
    return { ok: true };
  }

  // ───────────── Messages ─────────────

  async list(c: MailCtx, q: ListQuery) {
    const conds: Record<string, unknown>[] = [];
    if (q.folderId === 'starred') conds.push({ hasKeyword: '$flagged' });
    else if (q.folderId) conds.push({ inMailbox: q.folderId });
    if (q.q) conds.push({ text: q.q });
    if (q.from) conds.push({ from: q.from });
    if (q.to) conds.push({ to: q.to });
    if (q.subject) conds.push({ subject: q.subject });
    if (q.after) conds.push({ after: new Date(q.after).toISOString() });
    if (q.before) conds.push({ before: new Date(q.before).toISOString() });
    if (q.hasAttachment) conds.push({ hasAttachment: true });
    if (q.starred) conds.push({ hasKeyword: '$flagged' });
    if (q.unread) conds.push({ notKeyword: '$seen' });
    if (q.folderId === 'starred' || (!q.folderId && (q.q || q.from || q.to || q.subject))) {
      // Searches and the Starred view exclude Trash and Junk.
      const [trash, junk] = await Promise.all([this.roleId(c, 'trash').catch(() => null), this.roleId(c, 'junk').catch(() => null)]);
      const excl = [trash, junk].filter(Boolean) as string[];
      if (excl.length) conds.push({ inMailboxOtherThan: excl });
    }
    const filter = conds.length === 0 ? null : conds.length === 1 ? conds[0] : { operator: 'AND', conditions: conds };
    const resp = await this.call(c, [
      ['Email/query', { accountId: c.accountId, filter, sort: [{ property: 'receivedAt', isAscending: false }], collapseThreads: true, position: q.position, limit: q.limit, calculateTotal: true }, 'q'],
      ['Email/get', { accountId: c.accountId, '#ids': { resultOf: 'q', name: 'Email/query', path: '/ids' }, properties: SUMMARY_PROPS }, 'g'],
      ['Thread/get', { accountId: c.accountId, '#ids': { resultOf: 'g', name: 'Email/get', path: '/list/*/threadId' } }, 't'],
    ]);
    const query = resp[0][1];
    const threads = new Map<string, string[]>((resp[2][1].list as any[]).map((t) => [t.id, t.emailIds]));
    const items = (resp[1][1].list as any[]).map((e) => ({ ...e, threadSize: threads.get(e.threadId)?.length ?? 1 }));
    return { total: query.total ?? items.length, position: query.position, items };
  }

  private bodyText(e: any) {
    return (e.textBody ?? []).map((p: any) => e.bodyValues?.[p.partId]?.value ?? '').join('\n');
  }

  private renderEmail(c: MailCtx, e: any, allowRemoteImages: boolean) {
    const base = `/api/v1/webmail/${c.mailboxId}/blobs`;
    const cidMap: Record<string, string> = {};
    for (const a of e.attachments ?? []) {
      if (a.cid && PREVIEWABLE.has(a.type)) cidMap[a.cid] = `${base}/${encodeURIComponent(a.blobId)}?inline=1&type=${encodeURIComponent(a.type)}&name=${encodeURIComponent(a.name ?? 'image')}`;
    }
    const htmlParts = (e.htmlBody ?? []).filter((p: any) => p.type === 'text/html');
    let rendered;
    if (htmlParts.length) {
      const raw = htmlParts.map((p: any) => e.bodyValues?.[p.partId]?.value ?? '').join('\n');
      rendered = sanitizeEmailHtml(raw, { allowRemoteImages, cidMap });
    } else {
      rendered = { html: textToHtml(this.bodyText(e)), blockedRemoteImages: 0, suspiciousLinks: 0 };
    }
    const attachments = (e.attachments ?? [])
      .filter((a: any) => !(a.cid && cidMap[a.cid] && a.disposition !== 'attachment'))
      .map((a: any) => ({ blobId: a.blobId, name: a.name ?? 'attachment', type: a.type, size: a.size, risk: attachmentRisk(a.name, a.type), previewable: PREVIEWABLE.has(a.type) }));
    const { bodyValues: _bv, textBody: _tb, htmlBody: _hb, ...meta } = e;
    return { ...meta, html: rendered.html, text: this.bodyText(e), blockedRemoteImages: rendered.blockedRemoteImages, suspiciousLinks: rendered.suspiciousLinks, attachments };
  }

  /** Full message plus the rest of its conversation. Marks the message read. */
  async get(c: MailCtx, id: string, allowRemoteImages = false) {
    const resp = await this.call(c, [
      ['Email/get', { accountId: c.accountId, ids: [id], properties: ['threadId'] }, 'a'],
      ['Thread/get', { accountId: c.accountId, '#ids': { resultOf: 'a', name: 'Email/get', path: '/list/*/threadId' } }, 't'],
      ['Email/get', { accountId: c.accountId, '#ids': { resultOf: 't', name: 'Thread/get', path: '/list/*/emailIds' }, properties: FULL_PROPS, fetchTextBodyValues: true, fetchHTMLBodyValues: true, maxBodyValueBytes: 2_000_000 }, 'g'],
    ]);
    const msgs = resp[2][1].list as any[];
    if (!msgs.length) throw new NotFoundException('Message not found');
    const unread = msgs.filter((m) => !m.keywords?.$seen).map((m) => m.id);
    if (unread.length) await this.setKeywords(c, unread, { $seen: true });
    const trashId = await this.roleId(c, 'trash').catch(() => null);
    const thread = msgs
      .filter((m) => m.id === id || !trashId || !m.mailboxIds?.[trashId])
      .sort((a, b) => +new Date(a.receivedAt) - +new Date(b.receivedAt))
      .map((m) => this.renderEmail(c, m, allowRemoteImages));
    return { id, threadId: msgs[0].threadId, messages: thread };
  }

  async setKeywords(c: MailCtx, ids: string[], keywords: Record<string, boolean>) {
    const update = Object.fromEntries(ids.map((id) => [id, Object.fromEntries(Object.entries(keywords).map(([k, v]) => [`keywords/${k}`, v ? true : null]))]));
    const [[, r]] = await this.call(c, [['Email/set', { accountId: c.accountId, update }, 's']]);
    return { updated: Object.keys(r.updated ?? {}).length, failed: Object.keys(r.notUpdated ?? {}) };
  }

  async move(c: MailCtx, ids: string[], toFolderId: string) {
    const update = Object.fromEntries(ids.map((id) => [id, { mailboxIds: { [toFolderId]: true } }]));
    const [[, r]] = await this.call(c, [['Email/set', { accountId: c.accountId, update }, 's']]);
    return { updated: Object.keys(r.updated ?? {}).length, failed: Object.keys(r.notUpdated ?? {}) };
  }

  async moveToRole(c: MailCtx, ids: string[], role: 'archive' | 'trash' | 'junk' | 'inbox') {
    return this.move(c, ids, await this.roleId(c, role));
  }

  /** Moves to Trash, or permanently deletes messages that are already in Trash. */
  async remove(c: MailCtx, ids: string[]) {
    const trash = await this.roleId(c, 'trash');
    const [[, g]] = await this.call(c, [['Email/get', { accountId: c.accountId, ids, properties: ['mailboxIds'] }, 'g']]);
    const inTrash = (g.list as any[]).filter((e) => e.mailboxIds?.[trash]).map((e) => e.id);
    const toTrash = (g.list as any[]).filter((e) => !e.mailboxIds?.[trash]).map((e) => e.id);
    const calls: MethodCall[] = [];
    if (toTrash.length) calls.push(['Email/set', { accountId: c.accountId, update: Object.fromEntries(toTrash.map((id) => [id, { mailboxIds: { [trash]: true } }])) }, 'm']);
    if (inTrash.length) calls.push(['Email/set', { accountId: c.accountId, destroy: inTrash }, 'd']);
    if (calls.length) await this.call(c, calls);
    return { trashed: toTrash.length, destroyed: inTrash.length };
  }

  // ───────────── Compose / drafts / send ─────────────

  async identities(c: MailCtx) {
    const [[, r]] = await this.call(c, [['Identity/get', { accountId: c.accountId }, 'i']]);
    return r.list as any[];
  }

  async updateIdentity(c: MailCtx, id: string, patch: { name?: string; textSignature?: string; htmlSignature?: string }) {
    const clean = { ...patch, ...(patch.htmlSignature !== undefined ? { htmlSignature: sanitizeEmailHtml(patch.htmlSignature, { allowRemoteImages: true, cidMap: {} }).html } : {}) };
    const [[, r]] = await this.call(c, [['Identity/set', { accountId: c.accountId, update: { [id]: clean } }, 's']]);
    if (r.notUpdated?.[id]) throw new BadRequestException(r.notUpdated[id].description ?? 'Could not update identity');
    return { ok: true };
  }

  private async buildEmail(c: MailCtx, input: ComposeInput, draftsId: string, asDraft: boolean) {
    const identities = await this.identities(c);
    const identity = identities.find((i) => i.id === input.identityId) ?? identities.find((i) => i.email === c.address) ?? identities[0];
    if (!identity) throw new BadRequestException('No sending identity available');
    let inReplyTo: string[] | null = null;
    let references: string[] | null = null;
    if (input.inReplyToId) {
      const [[, r]] = await this.call(c, [['Email/get', { accountId: c.accountId, ids: [input.inReplyToId], properties: ['messageId', 'references'] }, 'g']]);
      const orig = r.list?.[0];
      if (orig?.messageId) {
        inReplyTo = orig.messageId;
        references = [...(orig.references ?? []), ...orig.messageId];
      }
    }
    const html = input.html ? sanitizeEmailHtml(input.html, { allowRemoteImages: true, cidMap: {} }).html : undefined;
    const text = input.text ?? (html ? html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() : '');
    const bodyValues: Record<string, { value: string }> = { t: { value: text } };
    if (html) bodyValues.h = { value: `<!doctype html><html><body>${html}</body></html>` };
    // Stalwart rejects null for address fields, so empty optional properties are omitted.
    const email: Record<string, unknown> = {
      mailboxIds: { [draftsId]: true },
      keywords: asDraft ? { $seen: true, $draft: true } : { $seen: true },
      from: [{ name: identity.name || c.displayName, email: identity.email }],
      to: input.to,
      subject: input.subject,
      bodyValues,
      textBody: [{ partId: 't', type: 'text/plain' }],
    };
    if (html) email.htmlBody = [{ partId: 'h', type: 'text/html' }];
    if (input.cc.length) email.cc = input.cc;
    if (input.bcc.length) email.bcc = input.bcc;
    if (inReplyTo) email.inReplyTo = inReplyTo;
    if (references) email.references = references;
    if (input.attachments.length) {
      email.attachments = input.attachments.map((a) => ({ blobId: a.blobId, type: a.type || 'application/octet-stream', name: a.name, disposition: 'attachment' }));
    }
    return { email, identity };
  }

  async saveDraft(c: MailCtx, input: ComposeInput) {
    const drafts = await this.roleId(c, 'drafts');
    const { email } = await this.buildEmail(c, input, drafts, true);
    const calls: MethodCall[] = [['Email/set', { accountId: c.accountId, create: { d: email }, ...(input.draftId ? { destroy: [input.draftId] } : {}) }, 's']];
    const [[, r]] = await this.call(c, calls);
    if (r.notCreated?.d) throw new BadRequestException(r.notCreated.d.description ?? 'Could not save draft');
    return { draftId: r.created.d.id as string };
  }

  async send(c: MailCtx, input: ComposeInput) {
    const recipients = input.to.length + input.cc.length + input.bcc.length;
    if (!recipients) throw new BadRequestException('Add at least one recipient');
    if (recipients > 100) throw new BadRequestException('At most 100 recipients per message');
    await this.rl.enforce(`send:${c.mailboxId}`, c.sendLimitPerHour, 3600, `Sending limit reached (${c.sendLimitPerHour} messages per hour)`);
    const [drafts, sent] = await Promise.all([this.roleId(c, 'drafts'), this.roleId(c, 'sent')]);
    const { email, identity } = await this.buildEmail(c, input, drafts, false);
    const answered = input.inReplyToId ? { [input.inReplyToId]: { 'keywords/$answered': true } } : {};
    let resp;
    try {
      resp = await this.call(c, [
        ['Email/set', { accountId: c.accountId, create: { e: email }, ...(input.draftId ? { destroy: [input.draftId] } : {}) }, 'a'],
        ['EmailSubmission/set', { accountId: c.accountId, create: { s: { emailId: '#e', identityId: identity.id } }, onSuccessUpdateEmail: { '#s': { [`mailboxIds/${drafts}`]: null, [`mailboxIds/${sent}`]: true, 'keywords/$draft': null } } }, 'b'],
        ...(input.inReplyToId ? ([['Email/set', { accountId: c.accountId, update: answered }, 'c']] as MethodCall[]) : []),
      ]);
    } catch (e) {
      if (e instanceof StalwartError) throw new BadRequestException(`Message not sent: ${e.message}`);
      throw e;
    }
    const created = resp[0][1];
    if (created.notCreated?.e) throw new BadRequestException(`Message not sent: ${created.notCreated.e.description ?? created.notCreated.e.type}`);
    const sub = resp[1][1];
    if (sub.notCreated?.s) {
      // Keep the composed message as a draft so the user does not lose it.
      throw new BadRequestException(`Message not sent: ${sub.notCreated.s.description ?? sub.notCreated.s.type}. It was kept in Drafts.`);
    }
    return { emailId: created.created.e.id as string, submissionId: sub.created.s.id as string };
  }

  // ───────────── Blobs ─────────────

  upload(c: MailCtx, data: Buffer, type: string) {
    return this.stalwart.upload(c.key, c.accountId, data, type);
  }

  download(c: MailCtx, blobId: string) {
    return this.stalwart.download(c.key, c.accountId, blobId);
  }

  // ───────────── Vacation / auto-reply ─────────────

  async vacation(c: MailCtx) {
    const [[, r]] = await this.call(c, [['VacationResponse/get', { accountId: c.accountId, ids: ['singleton'] }, 'v']], [CORE, MAIL, VACATION]);
    return r.list?.[0] ?? { isEnabled: false };
  }

  async setVacation(c: MailCtx, v: { isEnabled: boolean; fromDate?: string | null; toDate?: string | null; subject?: string | null; textBody?: string | null; htmlBody?: string | null }) {
    const [[, r]] = await this.call(c, [['VacationResponse/set', { accountId: c.accountId, update: { singleton: v } }, 'v']], [CORE, MAIL, VACATION]);
    if (r.notUpdated?.singleton) throw new BadRequestException(r.notUpdated.singleton.description ?? 'Could not update auto-reply');
    return this.vacation(c);
  }

  // ───────────── Contacts (JMAP for Contacts / JSContact) ─────────────

  private async addressBookId(c: MailCtx): Promise<string> {
    const [[, r]] = await this.call(c, [['AddressBook/get', { accountId: c.accountId }, 'a']], [CORE, CONTACTS]);
    const list = r.list as any[];
    const def = list.find((b) => b.isDefault) ?? list[0];
    if (def) return def.id;
    const [[, created]] = await this.call(c, [['AddressBook/set', { accountId: c.accountId, create: { b: { name: 'Contacts' } } }, 's']], [CORE, CONTACTS]);
    return created.created.b.id;
  }

  private cardToContact(card: any) {
    const email = Object.values(card.emails ?? {})[0] as any;
    const phone = Object.values(card.phones ?? {})[0] as any;
    const org = Object.values(card.organizations ?? {})[0] as any;
    return {
      id: card.id,
      name: card.name?.full ?? [card.name?.components?.find((x: any) => x.kind === 'given')?.value, card.name?.components?.find((x: any) => x.kind === 'surname')?.value].filter(Boolean).join(' '),
      email: email?.address ?? null,
      phone: phone?.number ?? null,
      company: org?.name ?? null,
      notes: (Object.values(card.notes ?? {})[0] as any)?.note ?? null,
    };
  }

  async contacts(c: MailCtx, q?: string) {
    const filter = q ? { text: q } : null;
    const resp = await this.call(
      c,
      [
        ['ContactCard/query', { accountId: c.accountId, filter, limit: 500 }, 'q'],
        ['ContactCard/get', { accountId: c.accountId, '#ids': { resultOf: 'q', name: 'ContactCard/query', path: '/ids' } }, 'g'],
      ],
      [CORE, CONTACTS],
    );
    return (resp[1][1].list as any[]).map((x) => this.cardToContact(x)).sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));
  }

  private contactToCard(input: { name: string; email?: string | null; phone?: string | null; company?: string | null; notes?: string | null }) {
    return {
      '@type': 'Card',
      version: '1.0',
      kind: 'individual',
      name: { full: input.name },
      emails: input.email ? { e1: { address: input.email } } : null,
      phones: input.phone ? { p1: { number: input.phone } } : null,
      organizations: input.company ? { o1: { name: input.company } } : null,
      notes: input.notes ? { n1: { note: input.notes } } : null,
    };
  }

  async createContact(c: MailCtx, input: { name: string; email?: string | null; phone?: string | null; company?: string | null; notes?: string | null }) {
    const book = await this.addressBookId(c);
    const [[, r]] = await this.call(c, [['ContactCard/set', { accountId: c.accountId, create: { n: { ...this.contactToCard(input), addressBookIds: { [book]: true } } } }, 's']], [CORE, CONTACTS]);
    if (r.notCreated?.n) throw new BadRequestException(r.notCreated.n.description ?? 'Could not create contact');
    return { id: r.created.n.id };
  }

  async updateContact(c: MailCtx, id: string, input: { name: string; email?: string | null; phone?: string | null; company?: string | null; notes?: string | null }) {
    const { '@type': _t, version: _v, ...card } = this.contactToCard(input);
    const [[, r]] = await this.call(c, [['ContactCard/set', { accountId: c.accountId, update: { [id]: card } }, 's']], [CORE, CONTACTS]);
    if (r.notUpdated?.[id]) throw new BadRequestException(r.notUpdated[id].description ?? 'Could not update contact');
    return { ok: true };
  }

  async deleteContact(c: MailCtx, id: string) {
    const [[, r]] = await this.call(c, [['ContactCard/set', { accountId: c.accountId, destroy: [id] }, 's']], [CORE, CONTACTS]);
    if (r.notDestroyed?.[id]) throw new BadRequestException('Could not delete contact');
    return { ok: true };
  }

  /** Address autocomplete: saved contacts plus recent correspondents. */
  async suggest(c: MailCtx, q: string) {
    const term = q.toLowerCase();
    const out = new Map<string, { name: string | null; email: string }>();
    try {
      for (const ct of await this.contacts(c, q)) if (ct.email) out.set(ct.email.toLowerCase(), { name: ct.name || null, email: ct.email });
    } catch {
      /* contacts capability may be disabled */
    }
    const resp = await this.call(c, [
      ['Email/query', { accountId: c.accountId, filter: { operator: 'OR', conditions: [{ to: q }, { from: q }] }, sort: [{ property: 'receivedAt', isAscending: false }], limit: 30 }, 'q'],
      ['Email/get', { accountId: c.accountId, '#ids': { resultOf: 'q', name: 'Email/query', path: '/ids' }, properties: ['from', 'to', 'cc'] }, 'g'],
    ]);
    for (const e of resp[1][1].list as any[]) {
      for (const a of [...(e.from ?? []), ...(e.to ?? []), ...(e.cc ?? [])] as Address[]) {
        const key = a.email?.toLowerCase();
        if (!key || key === c.address || out.has(key)) continue;
        if (key.includes(term) || (a.name ?? '').toLowerCase().includes(term)) out.set(key, { name: a.name ?? null, email: a.email });
      }
    }
    return [...out.values()].slice(0, 10);
  }

  // ───────────── Quota ─────────────

  async quota(c: MailCtx) {
    const mb = await this.prisma.mailbox.findUniqueOrThrow({ where: { id: c.mailboxId } });
    return { usedBytes: Number(mb.usedBytes), quotaMb: mb.quotaMb, syncedAt: mb.usageSyncedAt };
  }
}
