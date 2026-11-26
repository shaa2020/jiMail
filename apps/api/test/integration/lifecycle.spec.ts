/**
 * End-to-end platform lifecycle against REAL services: PostgreSQL, Redis and a Stalwart v1 server.
 * DNS is served by an in-process authoritative test server (no public DNS is touched).
 *
 * Covers: registration → email verification → login → domain ownership → DNS checks → mailboxes →
 * mailbox login → send/receive/reply with attachments → alias → forwarding → password reset →
 * suspend/reactivate → usage → tenant isolation → API keys/scopes → CSRF → 2FA → delivery webhook.
 */
import { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';
import { loadConfig } from '../../src/config/config';
import { PrismaService } from '../../src/common/prisma.service';
import { totp } from '../../src/common/totp';
import { BillingService } from '../../src/modules/billing/billing.service';
import { Client, waitFor } from '../support/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { FakeDns } = require('../support/fake-dns.js');

const run = Date.now().toString(36);
const cfg = loadConfig();
const outbox = cfg.MAIL_FILE_DIR;
const dnsPort = Number((cfg.DNS_RESOLVERS.split(',')[0].split(':')[1] ?? '5353'));

function lastMailTo(address: string): { subject: string; text: string } {
  const files = readdirSync(outbox).filter((f) => f.includes(address.replace(/[^a-z0-9@.]/gi, '_'))).sort();
  if (!files.length) throw new Error(`no mail for ${address}`);
  return JSON.parse(readFileSync(join(outbox, files[files.length - 1]), 'utf8'));
}
const tokenFrom = (text: string) => decodeURIComponent(text.match(/token=([^\s&]+)/)![1]);

describe('JiMail lifecycle (live Stalwart)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dns: any;
  let dnsIsOurs = false;

  const owner = { name: 'Olivia Owner', email: `owner-${run}@example.org`, password: 'Sup3rSecure!pass', organizationName: `Acme ${run}` };
  const intruder = { name: 'Ivan Intruder', email: `intruder-${run}@example.org`, password: 'An0ther!Secure1', organizationName: `Evil ${run}` };
  const domainName = `acme-${run}.test`;
  const ownerC = () => new Client(app);
  let o: Client; // owner session
  let x: Client; // intruder session
  let orgId: string;
  let otherOrgId: string;
  let domainId: string;
  let alice: { id: string; address: string; password: string };
  let bob: { id: string; address: string; password: string };

  beforeAll(async () => {
    rmSync(outbox, { recursive: true, force: true });
    dns = new FakeDns();
    if (process.env.FAKE_DNS_FILE) {
      // A standalone fake DNS (file-backed) is already running on this port: write to its file.
      dns.file = process.env.FAKE_DNS_FILE;
      dns.load();
    } else {
      await dns.listen(dnsPort);
      dnsIsOurs = true;
    }
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
    await app.get(BillingService).ensurePlans();
    // Start from clean rate-limit counters (all test traffic comes from 127.0.0.1).
    const redis = app.get((await import('../../src/common/redis.service')).RedisService).client;
    const keys = await redis.keys('rl:*');
    if (keys.length) await redis.del(...keys);
    o = ownerC();
    x = ownerC();
  });

  afterAll(async () => {
    if (!app) return;
    // Clean up mail-server objects created by this run.
    const stalwart = app.get((await import('../../src/modules/stalwart/stalwart.client')).StalwartClient);
    const mbs = await prisma.mailbox.findMany({ where: { organizationId: { in: [orgId, otherOrgId].filter(Boolean) } } });
    for (const m of mbs) if (m.stalwartId) await stalwart.destroyAccount(m.stalwartId).catch(() => undefined);
    const ds = await prisma.domain.findMany({ where: { organizationId: { in: [orgId, otherOrgId].filter(Boolean) } } });
    for (const d of ds) if (d.stalwartId) await stalwart.destroyDomain(d.stalwartId).catch(() => undefined);
    await app.close();
    if (dnsIsOurs) await dns.close();
  });

  it('1-2. registers a customer and verifies the email address', async () => {
    const reg = await o.post('/auth/register', owner, { csrf: false });
    expect(reg.status).toBe(202);
    const blocked = await o.post('/auth/login', { email: owner.email, password: owner.password }, { csrf: false });
    expect(blocked.status).toBe(403);
    expect(blocked.body.emailNotVerified).toBe(true);
    const mail = lastMailTo(owner.email);
    expect(mail.subject).toMatch(/Verify/);
    const v = await o.post('/auth/verify-email', { token: tokenFrom(mail.text) }, { csrf: false });
    expect(v.status).toBe(200);
    const reuse = await o.post('/auth/verify-email', { token: tokenFrom(mail.text) }, { csrf: false });
    expect(reuse.status).toBe(400);
  });

  it('rejects wrong passwords without revealing whether the user exists', async () => {
    const a = await ownerC().post('/auth/login', { email: owner.email, password: 'wrong-password' }, { csrf: false });
    const b = await ownerC().post('/auth/login', { email: `nobody-${run}@example.org`, password: 'wrong-password' }, { csrf: false });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it('3. logs in and sees the organisation created at signup', async () => {
    const r = await o.post('/auth/login', { email: owner.email, password: owner.password }, { csrf: false });
    expect(r.status).toBe(200);
    expect(r.body.mfaRequired).toBe(false);
    const me = await o.get('/me');
    expect(me.body.email).toBe(owner.email);
    expect(me.body.organizations).toHaveLength(1);
    orgId = me.body.organizations[0].id;
    expect(me.body.organizations[0].role).toBe('OWNER');
    const dash = await o.get(`/orgs/${orgId}/dashboard`);
    expect(dash.status).toBe(200);
    expect(dash.body.subscription.status).toBe('TRIALING');
  });

  it('enforces CSRF protection on mutating requests', async () => {
    const r = await o.post(`/orgs/${orgId}/domains`, { name: `csrf-${run}.test` }, { csrf: false });
    expect(r.status).toBe(403);
    expect(r.body.message).toMatch(/CSRF/);
  });

  it('4-5. adds a domain and verifies ownership only after the TXT record exists', async () => {
    const add = await o.post(`/orgs/${orgId}/domains`, { name: domainName.toUpperCase() });
    expect(add.status).toBe(201);
    expect(add.body.name).toBe(domainName);
    domainId = add.body.id;
    const { host, value } = add.body.ownershipRecord;

    const early = await o.post(`/orgs/${orgId}/domains/${domainId}/verify`);
    expect(early.body.verified).toBe(false);
    const mb = await o.post(`/orgs/${orgId}/mailboxes`, { domainId, localPart: 'early', displayName: 'Too early' });
    expect(mb.status).toBe(400);

    dns.set(host, 'TXT', ['unrelated', value]);
    const ok = await o.post(`/orgs/${orgId}/domains/${domainId}/verify`);
    expect(ok.status).toBe(200);
    expect(ok.body.verified).toBe(true);
    expect(ok.body.domain.status).toBe('VERIFIED'); // mail records not yet published
    expect(ok.body.domain.stalwartId).toBeTruthy();
  });

  it('6. generates DNS instructions from the mail server and marks the domain ACTIVE once published', async () => {
    const recs = await o.get(`/orgs/${orgId}/domains/${domainId}/records`);
    expect(recs.status).toBe(200);
    const records = recs.body.records as { type: string; host: string; value: string; priority?: number; required: boolean }[];
    expect(records.some((r) => r.type === 'MX' && r.value.startsWith(cfg.MAIL_HOSTNAME))).toBe(true);
    const dkim = records.filter((r) => r.host.includes('._domainkey.'));
    expect(dkim.length).toBeGreaterThanOrEqual(1);

    for (const r of records.filter((r) => r.required && r.type !== 'TXT' || r.type === 'TXT')) {
      if (r.type === 'MX') dns.set(r.host, 'MX', [{ exchange: r.value.replace(/\.$/, ''), priority: r.priority ?? 10 }]);
      else if (r.type === 'TXT' && !r.host.startsWith('_jimail')) dns.add(r.host, 'TXT', r.value);
    }
    const check = await o.post(`/orgs/${orgId}/domains/${domainId}/check`);
    expect(check.status).toBe(200);
    const failing = check.body.checks.filter((c: any) => c.required && c.status === 'FAIL');
    expect(failing).toEqual([]);
    expect(check.body.domain.status).toBe('ACTIVE');

    // A second SPF record must be detected as an error.
    dns.add(domainName, 'TXT', 'v=spf1 include:other.example -all');
    const bad = await o.post(`/orgs/${orgId}/domains/${domainId}/check`);
    expect(bad.body.checks.find((c: any) => c.kind === 'SPF').status).toBe('FAIL');
    expect(bad.body.domain.status).toBe('VERIFIED');
    dns.set(domainName, 'TXT', records.filter((r) => r.type === 'TXT' && r.host === domainName).map((r) => r.value));
    const good = await o.post(`/orgs/${orgId}/domains/${domainId}/check`);
    expect(good.body.domain.status).toBe('ACTIVE');
  });

  it('7. creates mailboxes (generated and chosen passwords) without exposing secrets in lists', async () => {
    const a = await o.post(`/orgs/${orgId}/mailboxes`, { domainId, localPart: 'Alice', displayName: 'Alice Anders', generatePassword: true, quotaMb: 512 });
    expect(a.status).toBe(201);
    expect(a.body.temporaryPassword).toMatch(/^.{18}$/);
    alice = { id: a.body.mailbox.id, address: `alice@${domainName}`, password: a.body.temporaryPassword };
    expect(a.body.mailbox.address).toBe(alice.address);

    const b = await o.post(`/orgs/${orgId}/mailboxes`, { domainId, localPart: 'bob', displayName: 'Bob Berg', password: 'BobsPassw0rd!x' });
    expect(b.status).toBe(201);
    expect(b.body.temporaryPassword).toBeUndefined();
    bob = { id: b.body.mailbox.id, address: `bob@${domainName}`, password: 'BobsPassw0rd!x' };

    const dup = await o.post(`/orgs/${orgId}/mailboxes`, { domainId, localPart: 'bob', displayName: 'Dup' });
    expect(dup.status).toBe(409);
    const weak = await o.post(`/orgs/${orgId}/mailboxes`, { domainId, localPart: 'weak', displayName: 'Weak', password: 'short' });
    expect(weak.status).toBe(400);

    const list = await o.get(`/orgs/${orgId}/mailboxes`);
    expect(list.body.total).toBe(2);
    expect(JSON.stringify(list.body)).not.toMatch(/serviceKey|password/i);
    const conn = await o.get(`/orgs/${orgId}/mailboxes/${alice.id}/connection`);
    expect(conn.body.imap).toEqual({ host: cfg.MAIL_HOSTNAME, port: cfg.IMAP_PORT, security: 'SSL/TLS' });
  });

  let aliceC: Client;
  let bobC: Client;
  let firstMessageId: string;

  it('8. mailbox users sign in to webmail with their mailbox password', async () => {
    aliceC = ownerC();
    const r = await aliceC.post('/auth/login', { email: alice.address, password: alice.password }, { csrf: false });
    expect(r.status).toBe(200);
    const boxes = await aliceC.get('/webmail/mailboxes');
    expect(boxes.body.map((m: any) => m.address)).toEqual([alice.address]);
    const folders = await aliceC.get(`/webmail/${alice.id}/folders`);
    const roles = folders.body.map((f: any) => f.role);
    expect(roles).toEqual(expect.arrayContaining(['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive']));
    bobC = ownerC();
    expect((await bobC.post('/auth/login', { email: bob.address, password: bob.password }, { csrf: false })).status).toBe(200);
  });

  it('9-12. sends with an attachment, receives, replies and downloads the attachment', async () => {
    const payload = Buffer.from(`JiMail attachment ${run}\n`.repeat(50));
    const up = await aliceC.upload(`/webmail/${alice.id}/blobs`, 'file', payload, 'report.txt', 'text/plain');
    expect(up.status).toBe(201);
    const draft = await aliceC.put(`/webmail/${alice.id}/drafts`, { to: [{ email: bob.address }], subject: `Draft ${run}`, html: '<p>draft</p>' });
    expect(draft.status).toBe(200);
    const sent = await aliceC.post(`/webmail/${alice.id}/send`, {
      to: [{ name: 'Bob', email: bob.address }],
      subject: `Quarterly report ${run}`,
      html: '<p>Hello <b>Bob</b><script>alert(1)</script><img src="https://tracker.example/p.gif"></p>',
      attachments: [{ blobId: up.body.blobId, name: 'report.txt', type: 'text/plain', size: payload.length }],
      draftId: draft.body.draftId,
    });
    expect(sent.status).toBe(200);

    const inbox = await waitFor(async () => {
      const folders = (await bobC.get(`/webmail/${bob.id}/folders`)).body;
      const inboxId = folders.find((f: any) => f.role === 'inbox').id;
      const l = await bobC.get(`/webmail/${bob.id}/messages?folderId=${inboxId}`);
      return l.body.items?.find((m: any) => m.subject === `Quarterly report ${run}`);
    });
    expect(inbox.hasAttachment).toBe(true);
    firstMessageId = inbox.id;

    const msg = await bobC.get(`/webmail/${bob.id}/messages/${inbox.id}`);
    const m = msg.body.messages[msg.body.messages.length - 1];
    expect(m.html).toContain('<b>Bob</b>');
    expect(m.html).not.toMatch(/<script/i);
    expect(m.html).not.toContain('tracker.example');
    expect(m.blockedRemoteImages).toBe(1);
    expect(m.attachments).toHaveLength(1);

    const dl = await bobC.agent.get(`/api/v1/webmail/${bob.id}/blobs/${encodeURIComponent(m.attachments[0].blobId)}?name=report.txt&type=text/plain`).buffer(true);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/^attachment/);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(dl.body).toString()).toBe(payload.toString());

    const sentFolder = (await aliceC.get(`/webmail/${alice.id}/folders`)).body.find((f: any) => f.role === 'sent');
    const sentList = await aliceC.get(`/webmail/${alice.id}/messages?folderId=${sentFolder.id}`);
    expect(sentList.body.items.some((x: any) => x.subject === `Quarterly report ${run}`)).toBe(true);

    const reply = await bobC.post(`/webmail/${bob.id}/send`, { to: [{ email: alice.address }], subject: `Re: Quarterly report ${run}`, text: 'Thanks Alice!', inReplyToId: inbox.id });
    expect(reply.status).toBe(200);
    const got = await waitFor(async () => {
      const l = await aliceC.get(`/webmail/${alice.id}/messages?q=${encodeURIComponent(`Re: Quarterly report ${run}`)}`);
      return l.body.items?.find((x: any) => x.subject === `Re: Quarterly report ${run}`);
    });
    const thread = await aliceC.get(`/webmail/${alice.id}/messages/${got.id}`);
    expect(thread.body.messages.length).toBeGreaterThanOrEqual(2); // threaded with the original
  });

  it('supports flags, search filters, archive and trash', async () => {
    const star = await bobC.post(`/webmail/${bob.id}/messages/keywords`, { ids: [firstMessageId], flagged: true });
    expect(star.body.updated).toBe(1);
    const starred = await bobC.get(`/webmail/${bob.id}/messages?folderId=starred`);
    expect(starred.body.items.map((i: any) => i.id)).toContain(firstMessageId);
    const filtered = await bobC.get(`/webmail/${bob.id}/messages?from=${encodeURIComponent(alice.address)}&hasAttachment=true`);
    expect(filtered.body.items.map((i: any) => i.id)).toContain(firstMessageId);
    const arch = await bobC.post(`/webmail/${bob.id}/messages/move`, { ids: [firstMessageId], role: 'archive' });
    expect(arch.body.updated).toBe(1);
    const del = await bobC.post(`/webmail/${bob.id}/messages/delete`, { ids: [firstMessageId] });
    expect(del.body.trashed).toBe(1);
  });

  it('13. delivers mail sent to an alias', async () => {
    const al = await o.post(`/orgs/${orgId}/mailboxes/${bob.id}/aliases`, { localPart: 'sales', domainId });
    expect(al.status).toBe(201);
    await aliceC.post(`/webmail/${alice.id}/send`, { to: [{ email: `sales@${domainName}` }], subject: `Alias ${run}`, text: 'to alias' });
    await waitFor(async () => (await bobC.get(`/webmail/${bob.id}/messages?q=${encodeURIComponent(`Alias ${run}`)}`)).body.items?.length);
  });

  it('14. forwards mail to another address while keeping a copy', async () => {
    const f = await o.put(`/orgs/${orgId}/mailboxes/${bob.id}/forwarding`, { addresses: [alice.address], keepCopy: true });
    expect(f.status).toBe(200);
    expect(f.body.forwardTo).toEqual([alice.address]);
    await aliceC.post(`/webmail/${alice.id}/send`, { to: [{ email: bob.address }], subject: `Forward ${run}`, text: 'forward me' });
    await waitFor(async () => (await bobC.get(`/webmail/${bob.id}/messages?q=${encodeURIComponent(`Forward ${run}`)}`)).body.items?.length);
    const inboxId = (await aliceC.get(`/webmail/${alice.id}/folders`)).body.find((x: any) => x.role === 'inbox').id;
    await waitFor(async () => (await aliceC.get(`/webmail/${alice.id}/messages?folderId=${inboxId}`)).body.items?.find((i: any) => i.subject === `Forward ${run}`));
    await o.put(`/orgs/${orgId}/mailboxes/${bob.id}/forwarding`, { addresses: [], keepCopy: true });
  });

  it('15. resets a mailbox password; the old password stops working', async () => {
    const r = await o.post(`/orgs/${orgId}/mailboxes/${alice.id}/reset-password`, {});
    expect(r.body.temporaryPassword).toBeTruthy();
    const old = await ownerC().post('/auth/login', { email: alice.address, password: alice.password }, { csrf: false });
    expect(old.status).toBe(401);
    alice.password = r.body.temporaryPassword;
    const fresh = ownerC();
    expect((await fresh.post('/auth/login', { email: alice.address, password: alice.password }, { csrf: false })).status).toBe(200);
    // previous webmail session was revoked
    expect((await aliceC.get('/webmail/mailboxes')).status).toBe(401);
    aliceC = fresh;
  });

  it('16-17. suspends and reactivates a mailbox on the mail server', async () => {
    const s = await o.post(`/orgs/${orgId}/mailboxes/${bob.id}/suspend`, { reason: 'test' });
    expect(s.body.status).toBe('SUSPENDED');
    const login = await ownerC().post('/auth/login', { email: bob.address, password: bob.password }, { csrf: false });
    expect(login.status).toBe(401); // Stalwart refuses authentication for suspended accounts
    const r = await o.post(`/orgs/${orgId}/mailboxes/${bob.id}/reactivate`);
    expect(r.body.status).toBe('ACTIVE');
    bobC = ownerC();
    expect((await bobC.post('/auth/login', { email: bob.address, password: bob.password }, { csrf: false })).status).toBe(200);
  });

  it('18. syncs storage usage from the mail server', async () => {
    const r = await o.post(`/orgs/${orgId}/mailboxes/sync-usage`);
    expect(r.body.synced).toBeGreaterThanOrEqual(2);
    const usage = await o.get(`/orgs/${orgId}/usage`);
    expect(usage.body.storage.usedBytes).toBeGreaterThan(0);
    expect(usage.body.mailboxes).toBe(2);
  });

  it('19. isolates tenants: another organisation cannot see or touch this data', async () => {
    await x.post('/auth/register', intruder, { csrf: false });
    await x.post('/auth/verify-email', { token: tokenFrom(lastMailTo(intruder.email).text) }, { csrf: false });
    await x.post('/auth/login', { email: intruder.email, password: intruder.password }, { csrf: false });
    otherOrgId = (await x.get('/me')).body.organizations[0].id;

    for (const url of [`/orgs/${orgId}`, `/orgs/${orgId}/domains`, `/orgs/${orgId}/mailboxes`, `/orgs/${orgId}/mailboxes/${alice.id}`, `/orgs/${orgId}/audit`, `/orgs/${orgId}/billing`]) {
      const r = await x.get(url);
      expect([403, 404]).toContain(r.status);
    }
    expect((await x.post(`/orgs/${orgId}/mailboxes/${alice.id}/suspend`, {})).status).toBe(404);
    expect((await x.get(`/webmail/${alice.id}/folders`)).status).toBe(404);
    // Object IDs from another tenant used under the intruder's own org are not found either.
    expect((await x.get(`/orgs/${otherOrgId}/mailboxes/${alice.id}`)).status).toBe(404);
    expect((await x.get(`/orgs/${otherOrgId}/domains/${domainId}`)).status).toBe(404);
    expect((await x.post(`/orgs/${otherOrgId}/mailboxes`, { domainId, localPart: 'steal', displayName: 'x' })).status).toBe(404);
    // Domain already claimed by another tenant
    const claim = await x.post(`/orgs/${otherOrgId}/domains`, { name: domainName });
    expect(claim.status).toBe(409);
    // Mailbox user cannot administer the organisation
    expect((await aliceC.get(`/orgs/${orgId}/mailboxes`)).status).toBe(403);
    expect((await aliceC.get('/admin/overview')).status).toBe(403);
  });

  it('API keys are tenant-bound and scope-limited', async () => {
    const k = await o.post(`/orgs/${orgId}/api-keys`, { name: 'provisioning', scopes: ['mailboxes:read', 'usage:read'] });
    expect(k.status).toBe(201);
    const auth = { Authorization: `Bearer ${k.body.secret}` };
    const srv = app.getHttpServer();
    expect((await request(srv).get(`/api/v1/orgs/${orgId}/mailboxes`).set(auth)).status).toBe(200);
    expect((await request(srv).get(`/api/v1/orgs/${orgId}/usage`).set(auth)).status).toBe(200);
    expect((await request(srv).post(`/api/v1/orgs/${orgId}/mailboxes`).set(auth).send({ domainId, localPart: 'k', displayName: 'k' })).status).toBe(403);
    expect((await request(srv).get(`/api/v1/orgs/${otherOrgId}/mailboxes`).set(auth)).status).toBe(404);
    expect((await request(srv).get(`/api/v1/orgs/${orgId}/members`).set(auth)).status).toBe(403);
    expect((await request(srv).get(`/api/v1/me`).set(auth)).status).toBe(403);
    expect((await request(srv).get(`/api/v1/webmail/mailboxes`).set(auth)).status).toBe(403);
    expect((await request(srv).get(`/api/v1/admin/overview`).set(auth)).status).toBe(403);
    const rot = await o.post(`/orgs/${orgId}/api-keys/${k.body.id}/rotate`);
    expect((await request(srv).get(`/api/v1/orgs/${orgId}/mailboxes`).set(auth)).status).toBe(401);
    expect((await request(srv).get(`/api/v1/orgs/${orgId}/mailboxes`).set({ Authorization: `Bearer ${rot.body.secret}` })).status).toBe(200);
  });

  it('20. organisation administration: invitations and role limits', async () => {
    const inv = await o.post(`/orgs/${orgId}/invitations`, { email: `admin-${run}@example.org`, role: 'MAILBOX_ADMIN' });
    expect(inv.status).toBe(201);
    const token = tokenFrom(lastMailTo(`admin-${run}@example.org`).text);
    const info = await ownerC().get(`/invitations/${token}`);
    expect(info.body.organizationName).toBe(owner.organizationName);
    const reg = await ownerC().post(`/invitations/${token}/register`, { name: 'Mia Admin', password: 'MiaPassw0rd!!' }, { csrf: false });
    expect(reg.status).toBe(201);
    const mia = ownerC();
    expect((await mia.post('/auth/login', { email: `admin-${run}@example.org`, password: 'MiaPassw0rd!!' }, { csrf: false })).status).toBe(200);
    expect((await mia.get(`/orgs/${orgId}/mailboxes`)).status).toBe(200);
    // A mailbox admin cannot delete mailboxes, invite or manage billing
    expect((await mia.del(`/orgs/${orgId}/mailboxes/${alice.id}`, { confirmAddress: alice.address })).status).toBe(403);
    expect((await mia.post(`/orgs/${orgId}/invitations`, { email: 'z@example.org', role: 'OWNER' })).status).toBe(403);
    expect((await mia.get(`/orgs/${orgId}/billing`)).status).toBe(403);
    // Owner cannot be demoted when last owner
    const ownerId = (await o.get('/me')).body.id;
    expect((await o.patch(`/orgs/${orgId}/members/${ownerId}`, { role: 'ADMIN' })).status).toBe(400);
    const audit = await o.get(`/orgs/${orgId}/audit?pageSize=100`);
    const actions = audit.body.items.map((a: any) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['domain.verified', 'mailbox.created', 'mailbox.suspended', 'alias.created', 'member.invited']));
  });

  it('two-factor authentication with TOTP and recovery codes', async () => {
    const setup = await o.post('/auth/2fa/setup');
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const conf = await o.post('/auth/2fa/confirm', { code: totp(setup.body.secret) });
    expect(conf.body.recoveryCodes).toHaveLength(10);
    const c = ownerC();
    const l = await c.post('/auth/login', { email: owner.email, password: owner.password }, { csrf: false });
    expect(l.body.mfaRequired).toBe(true);
    expect((await c.get(`/orgs/${orgId}/dashboard`)).status).toBe(401);
    expect((await c.post('/auth/mfa', { code: '000000' })).status).toBe(401);
    expect((await c.post('/auth/mfa', { code: conf.body.recoveryCodes[0] })).status).toBe(200);
    expect((await c.get(`/orgs/${orgId}/dashboard`)).status).toBe(200);
    const c2 = ownerC();
    await c2.post('/auth/login', { email: owner.email, password: owner.password }, { csrf: false });
    expect((await c2.post('/auth/mfa', { code: conf.body.recoveryCodes[0] })).status).toBe(401); // single use
  });

  it('ingests signed delivery webhooks and attributes them to the tenant', async () => {
    const body = JSON.stringify({
      events: [
        { id: `${run}1`, createdAt: new Date().toISOString(), type: 'delivery.dsn-perm-fail', data: { from: alice.address, to: 'nobody@nowhere.invalid', details: 'no MX' } },
        { id: `${run}2`, createdAt: new Date().toISOString(), type: 'message-ingest.ham', data: { from: 'x@y.z', to: [bob.address] } },
      ],
    });
    const sig = createHmac('sha256', cfg.STALWART_WEBHOOK_SECRET!).update(body).digest('base64');
    const srv = app.getHttpServer();
    expect((await request(srv).post('/api/v1/stalwart/webhook').set('Content-Type', 'application/json').set('X-Signature', 'bad').send(body)).status).toBe(401);
    const ok = await request(srv).post('/api/v1/stalwart/webhook').set('Content-Type', 'application/json').set('X-Signature', sig).send(body);
    expect(ok.body.stored).toBe(2);
    const again = await request(srv).post('/api/v1/stalwart/webhook').set('Content-Type', 'application/json').set('X-Signature', sig).send(body);
    expect(again.body.stored).toBe(0); // idempotent
    const stats = await o.get(`/orgs/${orgId}/delivery?days=1`);
    expect(stats.body.totals.bounce).toBeGreaterThanOrEqual(1);
    expect(stats.body.totals.ham).toBeGreaterThanOrEqual(1);
    expect((await x.get(`/orgs/${otherOrgId}/delivery?days=1`)).body.totals.bounce ?? 0).toBe(0);
  });

  it('deletes mailboxes and domains with safeguards', async () => {
    expect((await o.del(`/orgs/${orgId}/domains/${domainId}`)).status).toBe(400); // mailboxes exist
    expect((await o.del(`/orgs/${orgId}/mailboxes/${bob.id}`, { confirmAddress: 'wrong@x.y' })).status).toBe(400);
    expect((await o.del(`/orgs/${orgId}/mailboxes/${bob.id}`, { confirmAddress: bob.address })).status).toBe(200);
    expect((await ownerC().post('/auth/login', { email: bob.address, password: bob.password }, { csrf: false })).status).toBe(401);
  });
});
