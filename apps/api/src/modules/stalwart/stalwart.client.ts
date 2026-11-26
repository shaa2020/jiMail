import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { loadConfig } from '../../config/config';
import { logger } from '../../common/logger';

/**
 * Thin, typed client for Stalwart Mail Server v1.x.
 *
 * Management uses the JMAP endpoint (/jmap/) with the `urn:stalwart:jmap` capability and
 * `x:<Object>/get|set|query` methods, as documented at https://stalw.art/docs/ref/.
 * Lists and sets are encoded as JSON objects ({"0": ...} / {"member": true}), never arrays.
 *
 * Two credentials are used:
 *  - the admin API key (STALWART_API_KEY) for provisioning — server-side only;
 *  - a per-mailbox API key (created via impersonation, stored encrypted) for webmail JMAP calls.
 */

export const CORE = 'urn:ietf:params:jmap:core';
export const MGMT = 'urn:stalwart:jmap';
export const MAIL = 'urn:ietf:params:jmap:mail';
export const SUBMISSION = 'urn:ietf:params:jmap:submission';
export const VACATION = 'urn:ietf:params:jmap:vacationresponse';
export const CONTACTS = 'urn:ietf:params:jmap:contacts';
export const CALENDARS = 'urn:ietf:params:jmap:calendars';

export type MethodCall = [string, Record<string, unknown>, string];
export type MethodResponse = [string, any, string];

export class StalwartError extends Error {
  constructor(
    message: string,
    readonly type?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface StalwartDomain {
  id: string;
  name: string;
  enable: boolean;
  catchAllAddress: string | null;
  dnsZoneFile?: string;
}

export interface StalwartAccount {
  id: string;
  name: string;
  domainId: string;
  emailAddress: string;
  description?: string | null;
  usedDiskQuota: number;
  quotas: Record<string, number>;
  aliases: Record<string, { name: string; domainId: string; enable?: boolean }>;
  permissions: { '@type': string; disabledPermissions?: Record<string, boolean> };
}

const SUSPEND_PERMS = { authenticate: true, emailReceive: true, emailSend: true };

@Injectable()
export class StalwartClient {
  private readonly cfg = loadConfig();
  private readonly base = this.cfg.STALWART_URL.replace(/\/$/, '');

  get configured() {
    return !!this.cfg.STALWART_API_KEY;
  }

  private adminKey(): string {
    if (!this.cfg.STALWART_API_KEY) {
      throw new ServiceUnavailableException('Mail server integration is not configured (STALWART_API_KEY missing)');
    }
    return this.cfg.STALWART_API_KEY;
  }

  /** Raw JMAP request with a bearer credential. */
  async jmap(authorization: string, using: string[], methodCalls: MethodCall[]): Promise<MethodResponse[]> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/jmap/`, {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ using, methodCalls }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'Stalwart unreachable');
      throw new ServiceUnavailableException('Mail server is unreachable');
    }
    if (res.status === 401 || res.status === 403) throw new StalwartError('Mail server rejected the credentials', 'unauthorized');
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new StalwartError(`Mail server error ${res.status}`, 'http', body.slice(0, 500));
    }
    const json = (await res.json()) as { methodResponses: MethodResponse[] };
    for (const [name, args] of json.methodResponses) {
      if (name === 'error') throw new StalwartError(args.description ?? args.type ?? 'JMAP error', args.type, args);
    }
    return json.methodResponses;
  }

  async admin(methodCalls: MethodCall[], extra: string[] = []) {
    return this.jmap(`Bearer ${this.adminKey()}`, [CORE, MGMT, ...extra], methodCalls);
  }

  /** Throws a readable error when a /set call did not apply. */
  private assertSet(resp: any, kind: 'created' | 'updated' | 'destroyed', id: string) {
    const failMap = kind === 'created' ? resp.notCreated : kind === 'updated' ? resp.notUpdated : resp.notDestroyed;
    const failure = failMap?.[id];
    if (failure) {
      const props = failure.properties ? ` (${(failure.properties as string[]).join(', ')})` : '';
      throw new StalwartError(`${failure.description ?? failure.type}${props}`, failure.type, failure);
    }
    if (kind === 'destroyed') {
      if (!(resp.destroyed as string[] | undefined)?.includes(id)) throw new StalwartError('Object was not deleted');
      return undefined;
    }
    const ok = resp[kind]?.[id];
    if (ok === undefined) throw new StalwartError(`Object was not ${kind}`);
    return ok;
  }

  // ─────────────── Health ───────────────

  async health(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const t = Date.now();
    try {
      const r = await fetch(`${this.base}/healthz/live`, { signal: AbortSignal.timeout(5000) });
      return { ok: r.ok, latencyMs: Date.now() - t, error: r.ok ? undefined : `HTTP ${r.status}` };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - t, error: (err as Error).message };
    }
  }

  // ─────────────── Domains ───────────────

  async createDomain(name: string): Promise<string> {
    const [[, r]] = await this.admin([
      [
        'x:Domain/set',
        {
          create: {
            d: {
              name,
              aliases: {},
              certificateManagement: { '@type': 'Manual' },
              dnsManagement: { '@type': 'Manual' },
              dkimManagement: { '@type': 'Automatic' },
              subAddressing: { '@type': 'Enabled' },
            },
          },
        },
        'c',
      ],
    ]);
    return this.assertSet(r, 'created', 'd').id;
  }

  async findDomainByName(name: string): Promise<StalwartDomain | null> {
    const resp = await this.admin([
      ['x:Domain/query', { filter: { name } }, 'q'],
      ['x:Domain/get', { '#ids': { resultOf: 'q', name: 'x:Domain/query', path: '/ids' }, properties: ['name', 'enable', 'catchAllAddress'] }, 'g'],
    ]);
    const list = resp[1][1].list as StalwartDomain[];
    return list.find((d) => d.name === name) ?? null;
  }

  async getDomain(id: string, withZone = false): Promise<StalwartDomain | null> {
    const props = ['name', 'enable', 'catchAllAddress', ...(withZone ? ['dnsZoneFile'] : [])];
    const [[, r]] = await this.admin([['x:Domain/get', { ids: [id], properties: props }, 'g']]);
    return (r.list as StalwartDomain[])[0] ?? null;
  }

  async updateDomain(id: string, patch: Partial<{ enable: boolean; catchAllAddress: string | null; description: string }>) {
    const [[, r]] = await this.admin([['x:Domain/set', { update: { [id]: patch } }, 'c']]);
    this.assertSet(r, 'updated', id);
  }

  async destroyDomain(id: string) {
    const [[, r]] = await this.admin([['x:Domain/set', { destroy: [id] }, 'c']]);
    this.assertSet(r, 'destroyed', id);
  }

  // ─────────────── Accounts (mailboxes) ───────────────

  async createUser(input: { name: string; domainId: string; password: string; description: string; quotaBytes: number }): Promise<string> {
    const [[, r]] = await this.admin([
      [
        'x:Account/set',
        {
          create: {
            u: {
              '@type': 'User',
              name: input.name,
              domainId: input.domainId,
              description: input.description,
              credentials: { '0': { '@type': 'Password', secret: input.password } },
              aliases: {},
              memberGroupIds: {},
              roles: { '@type': 'User' },
              permissions: { '@type': 'Inherit' },
              quotas: input.quotaBytes > 0 ? { maxDiskQuota: input.quotaBytes } : {},
              encryptionAtRest: { '@type': 'Disabled' },
            },
          },
        },
        'c',
      ],
    ]);
    return this.assertSet(r, 'created', 'u').id;
  }

  async getAccount(id: string): Promise<StalwartAccount | null> {
    const [[, r]] = await this.admin([
      ['x:Account/get', { ids: [id], properties: ['name', 'domainId', 'emailAddress', 'description', 'usedDiskQuota', 'quotas', 'aliases', 'permissions'] }, 'g'],
    ]);
    return (r.list as StalwartAccount[])[0] ?? null;
  }

  async getAccounts(ids: string[]): Promise<StalwartAccount[]> {
    if (!ids.length) return [];
    const out: StalwartAccount[] = [];
    for (let i = 0; i < ids.length; i += 400) {
      const [[, r]] = await this.admin([['x:Account/get', { ids: ids.slice(i, i + 400), properties: ['name', 'usedDiskQuota', 'quotas'] }, 'g']]);
      out.push(...(r.list as StalwartAccount[]));
    }
    return out;
  }

  async updateAccount(id: string, patch: Record<string, unknown>) {
    const [[, r]] = await this.admin([['x:Account/set', { update: { [id]: patch } }, 'c']]);
    this.assertSet(r, 'updated', id);
  }

  setPassword(id: string, password: string) {
    // The password credential is always created at position 0 by JiMail.
    return this.updateAccount(id, { 'credentials/0/secret': password });
  }

  setQuota(id: string, quotaBytes: number) {
    return this.updateAccount(id, { 'quotas/maxDiskQuota': quotaBytes > 0 ? quotaBytes : null });
  }

  setDescription(id: string, description: string) {
    return this.updateAccount(id, { description });
  }

  /** Suspension = explicitly disabled permissions (they override every role). */
  suspendAccount(id: string) {
    return this.updateAccount(id, { permissions: { '@type': 'Merge', enabledPermissions: {}, disabledPermissions: SUSPEND_PERMS } });
  }

  reactivateAccount(id: string) {
    return this.updateAccount(id, { permissions: { '@type': 'Inherit' } });
  }

  /** Only disables outgoing mail (abuse containment) while keeping receiving and login. */
  blockSending(id: string) {
    return this.updateAccount(id, { permissions: { '@type': 'Merge', enabledPermissions: {}, disabledPermissions: { emailSend: true } } });
  }

  setAlias(accountId: string, position: number, alias: { name: string; domainId: string } | null) {
    return this.updateAccount(accountId, { [`aliases/${position}`]: alias ? { name: alias.name, domainId: alias.domainId, enable: true } : null });
  }

  async destroyAccount(id: string) {
    const [[, r]] = await this.admin([['x:Account/set', { destroy: [id] }, 'c']]);
    this.assertSet(r, 'destroyed', id);
  }

  /** Creates an API key owned by the mailbox account (requires impersonate + sysApiKeyCreate). */
  async createMailboxServiceKey(accountId: string): Promise<string> {
    const [[, r]] = await this.admin([
      [
        'x:ApiKey/set',
        { accountId, create: { k: { description: 'JiMail webmail (server-side)', permissions: { '@type': 'Inherit' }, allowedIps: {} } } },
        'c',
      ],
    ]);
    return this.assertSet(r, 'created', 'k').secret as string;
  }

  /** Verifies mailbox credentials against Stalwart (HTTP Basic on the JMAP session resource). */
  async verifyCredentials(email: string, password: string): Promise<boolean> {
    try {
      const r = await fetch(`${this.base}/jmap/session`, {
        headers: { Authorization: `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}` },
        signal: AbortSignal.timeout(10_000),
      });
      return r.status === 200;
    } catch {
      throw new ServiceUnavailableException('Mail server is unreachable');
    }
  }

  // ─────────────── Mail rules (forwarding) ───────────────

  async setForwarding(accountId: string, existingRuleId: string | null, addresses: string[], keepCopy: boolean): Promise<string | null> {
    if (!addresses.length) {
      if (existingRuleId) {
        const [[, r]] = await this.admin([['x:MailRule/set', { accountId, destroy: [existingRuleId] }, 'c']]);
        if (r.notDestroyed?.[existingRuleId]?.type !== 'notFound') this.assertSet(r, 'destroyed', existingRuleId);
      }
      return null;
    }
    const actions = {
      addKeywords: {},
      removeKeywords: {},
      copyTo: {},
      moveTo: {},
      redirect: { addresses: Object.fromEntries(addresses.map((a) => [a, true])), keepCopy },
    };
    if (existingRuleId) {
      const [[, r]] = await this.admin([['x:MailRule/set', { accountId, update: { [existingRuleId]: { actions, isEnabled: true } } }, 'c']]);
      if (!r.notUpdated?.[existingRuleId]) return existingRuleId;
    }
    const [[, r]] = await this.admin([
      [
        'x:MailRule/set',
        { accountId, create: { f: { name: 'JiMail forwarding', position: 0, conditions: { matchAll: {}, matchAny: {}, matchNone: {} }, actions } } },
        'c',
      ],
    ]);
    return this.assertSet(r, 'created', 'f').id;
  }

  // ─────────────── Queue & telemetry ───────────────

  async queueSummary(limit = 50) {
    const resp = await this.admin([
      ['x:QueuedMessage/query', { filter: {}, limit }, 'q'],
      ['x:QueuedMessage/get', { '#ids': { resultOf: 'q', name: 'x:QueuedMessage/query', path: '/ids' } }, 'g'],
    ]);
    const q = resp[0][1];
    const list = resp[1][1].list as any[];
    return {
      total: (q.total as number | undefined) ?? (q.ids as string[]).length,
      messages: list.map((m) => ({
        id: m.id as string,
        createdAt: m.createdAt as string,
        nextRetry: m.nextRetry as string | null,
        returnPath: m.returnPath as string,
        size: m.size as number,
        recipients: Object.entries((m.recipients ?? {}) as Record<string, any>).map(([address, r]) => ({
          address,
          status: r.status?.['@type'] ?? 'Scheduled',
          retryCount: r.retryCount ?? 0,
          lastError: r.status?.reason ?? r.status?.response?.message ?? null,
        })),
      })),
    };
  }

  async ensureWebhook(url: string, secret: string): Promise<string> {
    const events = [
      'delivery.delivered',
      'delivery.failed',
      'delivery.dsn-perm-fail',
      'delivery.dsn-temp-fail',
      'delivery.rcpt-to-rejected',
      'queue.authenticated-message-queued',
      'queue.message-queued',
      'queue.rate-limit-exceeded',
      'queue.quota-exceeded',
      'message-ingest.ham',
      'message-ingest.spam',
      'auth.failed',
      'auth.too-many-attempts',
      'security.authentication-ban',
      'security.abuse-ban',
      'incoming-report.abuse-report',
      'smtp.relay-not-allowed',
    ];
    const resp = await this.admin([
      ['x:WebHook/query', { filter: {} }, 'q'],
      ['x:WebHook/get', { '#ids': { resultOf: 'q', name: 'x:WebHook/query', path: '/ids' }, properties: ['url'] }, 'g'],
    ]);
    const existing = (resp[1][1].list as { id: string; url: string }[]).find((w) => w.url === url);
    const body = {
      url,
      enable: true,
      events: Object.fromEntries(events.map((e) => [e, true])),
      eventsPolicy: 'include',
      httpAuth: { '@type': 'Unauthenticated' },
      httpHeaders: {},
      signatureKey: { '@type': 'Value', secret },
    };
    let id: string;
    if (existing) {
      const [[, r]] = await this.admin([['x:WebHook/set', { update: { [existing.id]: body } }, 'c']]);
      this.assertSet(r, 'updated', existing.id);
      id = existing.id;
    } else {
      const [[, r]] = await this.admin([['x:WebHook/set', { create: { w: body } }, 'c']]);
      id = this.assertSet(r, 'created', 'w').id;
    }
    // Telemetry settings are applied on reload.
    await this.reloadSettings();
    return id;
  }

  async reloadSettings() {
    await this.admin([['x:Action/set', { create: { a: { '@type': 'ReloadSettings' } } }, 'c']]);
  }

  // ─────────────── Mailbox-level JMAP (webmail) ───────────────

  async mailbox(serviceKey: string, methodCalls: MethodCall[], using: string[] = [CORE, MAIL, SUBMISSION]) {
    return this.jmap(`Bearer ${serviceKey}`, using, methodCalls);
  }

  async upload(serviceKey: string, accountId: string, data: Buffer, type: string): Promise<{ blobId: string; size: number; type: string }> {
    const r = await fetch(`${this.base}/jmap/upload/${encodeURIComponent(accountId)}/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': type || 'application/octet-stream' },
      body: new Uint8Array(data),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) throw new StalwartError(`Upload failed (${r.status})`);
    return (await r.json()) as { blobId: string; size: number; type: string };
  }

  async download(serviceKey: string, accountId: string, blobId: string): Promise<Response> {
    const r = await fetch(`${this.base}/jmap/download/${encodeURIComponent(accountId)}/${encodeURIComponent(blobId)}/file?accept=application/octet-stream`, {
      headers: { Authorization: `Bearer ${serviceKey}` },
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) throw new StalwartError(`Download failed (${r.status})`, r.status === 404 ? 'notFound' : 'http');
    return r;
  }

  async mailboxAccountId(serviceKey: string): Promise<string> {
    const r = await fetch(`${this.base}/jmap/session`, { headers: { Authorization: `Bearer ${serviceKey}` }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new StalwartError('Mailbox session unavailable', r.status === 401 || r.status === 403 ? 'unauthorized' : 'http');
    const s = (await r.json()) as { primaryAccounts: Record<string, string> };
    return s.primaryAccounts[MAIL];
  }
}
