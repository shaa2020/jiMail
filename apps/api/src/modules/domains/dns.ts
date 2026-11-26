import { Resolver } from 'node:dns/promises';
import { DnsCheckStatus, DnsRecordKind } from '@prisma/client';

export interface ZoneRecord {
  host: string; // fully-qualified, no trailing dot, lowercase
  type: string;
  value: string; // TXT values are joined (quotes removed)
}

/**
 * Parses the BIND-format zone file Stalwart computes for a domain (Domain.dnsZoneFile).
 * Handles parenthesised multi-line records and multi-string TXT values.
 */
/** Removes a ;-comment that is outside double quotes (TXT values contain semicolons). */
function stripComment(line: string): string {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\') i++;
    else if (ch === '"') inQuote = !inQuote;
    else if (ch === ';' && !inQuote) return line.slice(0, i);
  }
  return line;
}

export function parseZoneFile(zone: string): ZoneRecord[] {
  const out: ZoneRecord[] = [];
  const logical: string[] = [];
  let buf = '';
  let depth = 0;
  for (const rawLine of zone.split('\n')) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    buf += (buf ? ' ' : '') + line;
    const unquoted = line.replace(/"(?:[^"\\]|\\.)*"/g, '');
    depth += (unquoted.match(/\(/g) ?? []).length - (unquoted.match(/\)/g) ?? []).length;
    if (depth <= 0) {
      logical.push(buf.replace(/("(?:[^"\\]|\\.)*")|[()]/g, (m, q) => q ?? ' ').replace(/\s+/g, ' ').trim());
      buf = '';
      depth = 0;
    }
  }
  for (const l of logical) {
    const m = l.match(/^(\S+)\s+(?:\d+\s+)?IN\s+(\S+)\s+(.*)$/i);
    if (!m) continue;
    const [, host, type, rest] = m;
    const t = type.toUpperCase();
    const value = t === 'TXT' ? [...rest.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]).join('') : rest.trim();
    out.push({ host: host.replace(/\.$/, '').toLowerCase(), type: t, value });
  }
  return out;
}

export interface CheckResult {
  kind: DnsRecordKind;
  host: string;
  type: string;
  expected: string;
  found: string | null;
  status: DnsCheckStatus;
  required: boolean;
  message: string;
}

export const OWNERSHIP_PREFIX = '_jimail';
export const ownershipHost = (domain: string) => `${OWNERSHIP_PREFIX}.${domain}`;
export const ownershipValue = (token: string) => `jimail-verification=${token}`;

const norm = (h: string) => h.toLowerCase().replace(/\.$/, '');

function dkimKey(v: string) {
  const m = v.replace(/\s/g, '').match(/(?:^|;)p=([^;]*)/);
  return m ? m[1] : null;
}

export class DnsChecker {
  private resolver: Resolver;

  constructor(servers: string[]) {
    this.resolver = new Resolver({ timeout: 4000, tries: 2 });
    if (servers.length) this.resolver.setServers(servers);
  }

  async txt(host: string): Promise<string[] | null> {
    try {
      return (await this.resolver.resolveTxt(host)).map((chunks) => chunks.join(''));
    } catch (e: any) {
      if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') return [];
      return null; // resolver failure (timeout, SERVFAIL)
    }
  }

  async mx(host: string): Promise<{ exchange: string; priority: number }[] | null> {
    try {
      return await this.resolver.resolveMx(host);
    } catch (e: any) {
      if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') return [];
      return null;
    }
  }

  async ptr(ip: string): Promise<string[] | null> {
    try {
      return await this.resolver.reverse(ip);
    } catch (e: any) {
      if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') return [];
      return null;
    }
  }

  async cname(host: string): Promise<string[]> {
    try {
      return await this.resolver.resolveCname(host);
    } catch {
      return [];
    }
  }

  async checkOwnership(domain: string, token: string): Promise<CheckResult> {
    const host = ownershipHost(domain);
    const expected = ownershipValue(token);
    const recs = await this.txt(host);
    const base = { kind: 'OWNERSHIP' as const, host, type: 'TXT', expected, required: true };
    if (recs === null) return { ...base, found: null, status: 'PENDING', message: 'DNS lookup failed, will retry' };
    const ok = recs.some((r) => r.trim() === expected);
    return {
      ...base,
      found: recs.join(' | ') || null,
      status: ok ? 'PASS' : 'FAIL',
      message: ok ? 'Domain ownership verified' : recs.length ? 'TXT record found but the value does not match' : 'TXT record not found yet (DNS changes can take up to 48 hours)',
    };
  }

  /** Runs every mail-delivery check for a verified domain. */
  async checkMailRecords(domain: string, zone: ZoneRecord[], opts: { mailHostname: string; publicIp?: string }): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    const mailHost = norm(opts.mailHostname);

    // MX
    const mx = await this.mx(domain);
    const mxOk = !!mx?.some((r) => norm(r.exchange) === mailHost);
    const foreign = (mx ?? []).filter((r) => norm(r.exchange) !== mailHost);
    results.push({
      kind: 'MX',
      host: domain,
      type: 'MX',
      expected: `10 ${mailHost}.`,
      found: mx === null ? null : mx.map((r) => `${r.priority} ${r.exchange}`).join(', ') || null,
      status: mx === null ? 'PENDING' : mxOk ? (foreign.length ? 'WARN' : 'PASS') : 'FAIL',
      required: true,
      message:
        mx === null
          ? 'DNS lookup failed, will retry'
          : !mxOk
            ? `MX must point to ${mailHost}`
            : foreign.length
              ? `Other MX hosts are still published (${foreign.map((f) => f.exchange).join(', ')}); remove them so all mail reaches JiMail`
              : 'Incoming mail is routed to JiMail',
    });

    // SPF
    const txt = await this.txt(domain);
    const spf = (txt ?? []).filter((r) => r.toLowerCase().startsWith('v=spf1'));
    const expectedSpf = zone.find((z) => z.type === 'TXT' && z.host === domain && z.value.startsWith('v=spf1'))?.value ?? 'v=spf1 mx -all';
    let spfStatus: DnsCheckStatus = 'FAIL';
    let spfMsg = 'No SPF record found';
    if (txt === null) {
      spfStatus = 'PENDING';
      spfMsg = 'DNS lookup failed, will retry';
    } else if (spf.length > 1) {
      spfMsg = 'Multiple SPF records found — merge them into one, otherwise SPF fails for all mail';
    } else if (spf.length === 1) {
      const terms = spf[0].toLowerCase().split(/\s+/);
      const authorises =
        (terms.some((t) => /^[+]?mx$/.test(t)) && mxOk) ||
        terms.includes(`a:${mailHost}`) ||
        terms.includes(`mx:${domain}`) ||
        (!!opts.publicIp && terms.some((t) => t === `ip4:${opts.publicIp}` || t === `ip6:${opts.publicIp}`));
      if (authorises) {
        spfStatus = 'PASS';
        spfMsg = 'SPF authorises the JiMail mail server';
      } else if (terms.some((t) => t.startsWith('include:') || t.startsWith('redirect='))) {
        spfStatus = 'WARN';
        spfMsg = 'SPF uses include/redirect; make sure it authorises the JiMail server (add "mx")';
      } else {
        spfMsg = 'SPF record does not authorise the JiMail mail server';
      }
      if (spfStatus !== 'FAIL' && /[~?]all$/.test(spf[0].trim())) spfMsg += '. Consider ending with "-all" once all senders are listed';
    }
    results.push({ kind: 'SPF', host: domain, type: 'TXT', expected: expectedSpf, found: spf.join(' | ') || null, status: spfStatus, required: true, message: spfMsg });

    // DKIM (every selector Stalwart signs with)
    const dkimRecs = zone.filter((z) => z.type === 'TXT' && z.host.includes('._domainkey.'));
    for (const rec of dkimRecs) {
      const found = await this.txt(rec.host);
      const want = dkimKey(rec.value);
      const got = (found ?? []).map(dkimKey).filter(Boolean) as string[];
      const ok = !!want && got.includes(want);
      results.push({
        kind: 'DKIM',
        host: rec.host,
        type: 'TXT',
        expected: rec.value,
        found: found?.join(' | ') || null,
        status: found === null ? 'PENDING' : ok ? 'PASS' : 'FAIL',
        required: true,
        message: found === null ? 'DNS lookup failed, will retry' : ok ? 'DKIM public key published' : got.length ? 'A DKIM record exists but the key does not match' : 'DKIM record not found',
      });
    }
    if (!dkimRecs.length) {
      results.push({ kind: 'DKIM', host: `*._domainkey.${domain}`, type: 'TXT', expected: '(generated by mail server)', found: null, status: 'PENDING', required: true, message: 'DKIM keys have not been generated yet' });
    }

    // DMARC
    const dmarcHost = `_dmarc.${domain}`;
    const dmarc = await this.txt(dmarcHost);
    const dm = (dmarc ?? []).filter((r) => r.toUpperCase().startsWith('V=DMARC1'));
    const expectedDmarc = zone.find((z) => z.host === dmarcHost)?.value ?? `v=DMARC1; p=quarantine; rua=mailto:postmaster@${domain}`;
    results.push({
      kind: 'DMARC',
      host: dmarcHost,
      type: 'TXT',
      expected: expectedDmarc,
      found: dm.join(' | ') || null,
      status: dmarc === null ? 'PENDING' : dm.length === 1 ? (/p=none/i.test(dm[0]) ? 'WARN' : 'PASS') : 'FAIL',
      required: true,
      message:
        dmarc === null
          ? 'DNS lookup failed, will retry'
          : dm.length > 1
            ? 'Multiple DMARC records found — keep exactly one'
            : dm.length === 1
              ? /p=none/i.test(dm[0])
                ? 'DMARC policy is "none" (monitoring only); move to quarantine or reject when ready'
                : 'DMARC policy published'
              : 'No DMARC record found',
    });

    // Optional / recommended records
    const mtaSts = zone.find((z) => z.host === `_mta-sts.${domain}`);
    if (mtaSts) {
      const f = await this.txt(mtaSts.host);
      const ok = !!f?.some((v) => v.startsWith('v=STSv1'));
      results.push({ kind: 'MTA_STS', host: mtaSts.host, type: 'TXT', expected: mtaSts.value, found: f?.join(' | ') || null, status: ok ? 'PASS' : 'WARN', required: false, message: ok ? 'MTA-STS published' : 'Recommended: protects inbound mail against TLS downgrade' });
    }
    const tlsRpt = zone.find((z) => z.host === `_smtp._tls.${domain}`);
    if (tlsRpt) {
      const f = await this.txt(tlsRpt.host);
      const ok = !!f?.some((v) => v.startsWith('v=TLSRPTv1'));
      results.push({ kind: 'TLS_RPT', host: tlsRpt.host, type: 'TXT', expected: tlsRpt.value, found: f?.join(' | ') || null, status: ok ? 'PASS' : 'WARN', required: false, message: ok ? 'TLS reporting published' : 'Recommended: receive TLS failure reports' });
    }
    const autoconfig = zone.find((z) => z.host === `autoconfig.${domain}` && z.type === 'CNAME');
    if (autoconfig) {
      const f = await this.cname(autoconfig.host);
      const ok = f.some((c) => norm(c) === norm(autoconfig.value));
      results.push({ kind: 'AUTOCONFIG', host: autoconfig.host, type: 'CNAME', expected: autoconfig.value, found: f.join(', ') || null, status: ok ? 'PASS' : 'WARN', required: false, message: ok ? 'Mail clients can auto-configure' : 'Recommended: lets Thunderbird and others find settings automatically' });
    }
    return results;
  }

  /** Platform-level reverse DNS check for the mail server IP. */
  async checkPtr(ip: string | undefined, mailHostname: string): Promise<CheckResult> {
    const base = { kind: 'PTR' as const, host: ip ?? '(MAIL_PUBLIC_IP not set)', type: 'PTR', expected: `${norm(mailHostname)}.`, required: false };
    if (!ip) return { ...base, found: null, status: 'WARN', message: 'Set MAIL_PUBLIC_IP so JiMail can verify reverse DNS' };
    const names = await this.ptr(ip);
    if (names === null) return { ...base, found: null, status: 'PENDING', message: 'Reverse DNS lookup failed' };
    const ok = names.some((n) => norm(n) === norm(mailHostname));
    return { ...base, found: names.join(', ') || null, status: ok ? 'PASS' : 'FAIL', message: ok ? 'Reverse DNS matches the mail hostname' : 'Ask your hosting provider to set the PTR record of the server IP to the mail hostname' };
  }
}
