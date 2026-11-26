import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Domain, DomainStatus } from '@prisma/client';
import { loadConfig } from '../../config/config';
import { AuditService } from '../../common/audit.service';
import { randomToken } from '../../common/crypto';
import { logger } from '../../common/logger';
import { PrismaService } from '../../common/prisma.service';
import { Principal } from '../../common/principal';
import { BillingService } from '../billing/billing.service';
import { StalwartClient } from '../stalwart/stalwart.client';
import { CheckResult, DnsChecker, ownershipHost, ownershipValue, parseZoneFile } from './dns';

@Injectable()
export class DomainsService {
  private readonly cfg = loadConfig();
  readonly dns = new DnsChecker(this.cfg.DNS_RESOLVERS.split(',').map((s) => s.trim()).filter(Boolean));

  constructor(
    private readonly prisma: PrismaService,
    private readonly stalwart: StalwartClient,
    private readonly billing: BillingService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string) {
    const domains = await this.prisma.domain.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { mailboxes: { where: { status: { not: 'DELETED' } } }, aliases: true } }, dnsChecks: { select: { kind: true, status: true, required: true } } },
    });
    return domains.map(({ dnsChecks, ...d }) => ({
      ...d,
      checksSummary: {
        passed: dnsChecks.filter((c) => c.required && c.status === 'PASS').length,
        required: dnsChecks.filter((c) => c.required).length,
        warnings: dnsChecks.filter((c) => c.status === 'WARN').length,
      },
    }));
  }

  async get(organizationId: string, id: string) {
    const d = await this.prisma.domain.findFirst({ where: { id, organizationId }, include: { dnsChecks: { orderBy: [{ required: 'desc' }, { kind: 'asc' }] } } });
    if (!d) throw new NotFoundException('Domain not found');
    return d;
  }

  async add(p: Principal, organizationId: string, name: string, ip?: string) {
    const reserved = [this.cfg.MAIL_HOSTNAME.toLowerCase(), new URL(this.cfg.APP_URL).hostname.toLowerCase()];
    if (reserved.includes(name)) throw new BadRequestException('This hostname is reserved for the platform');
    await this.billing.assertCanAdd(organizationId, 'domain');
    const exists = await this.prisma.domain.findUnique({ where: { name } });
    if (exists) {
      throw new ConflictException(exists.organizationId === organizationId ? 'This domain is already added' : 'This domain is already registered on the platform. Contact support if you own it.');
    }
    const d = await this.prisma.domain.create({ data: { organizationId, name, verificationToken: randomToken(18).replace(/[^A-Za-z0-9]/g, '') } });
    await this.audit.record(p, { action: 'domain.added', organizationId, targetType: 'domain', targetId: d.id, metadata: { name }, ip });
    return this.withInstructions(d);
  }

  withInstructions<T extends Domain>(d: T) {
    return { ...d, ownershipRecord: { type: 'TXT', host: ownershipHost(d.name), value: ownershipValue(d.verificationToken) } };
  }

  /** Step 1: proves ownership via the TXT record, then provisions the domain in Stalwart. */
  async verifyOwnership(p: Principal | undefined, organizationId: string, id: string, ip?: string) {
    const d = await this.get(organizationId, id);
    if (d.status === 'SUSPENDED') throw new BadRequestException('Domain is suspended');
    if (d.verifiedAt && d.stalwartId) return this.runChecks(d.id);
    const res = await this.dns.checkOwnership(d.name, d.verificationToken);
    await this.saveChecks(d.id, [res]);
    if (res.status !== 'PASS') {
      await this.prisma.domain.update({ where: { id: d.id }, data: { lastCheckedAt: new Date() } });
      return { verified: false, check: res };
    }
    let stalwartId = d.stalwartId;
    if (!stalwartId) {
      const existing = await this.stalwart.findDomainByName(d.name);
      const linked = existing && (await this.prisma.domain.findUnique({ where: { stalwartId: existing.id } }));
      if (existing && linked && linked.id !== d.id) throw new ConflictException('Domain already provisioned for another organisation');
      stalwartId = existing?.id ?? (await this.stalwart.createDomain(d.name));
    }
    await this.prisma.domain.update({ where: { id: d.id }, data: { stalwartId, verifiedAt: new Date(), status: 'VERIFIED' } });
    await this.audit.record(p, { action: 'domain.verified', organizationId, targetType: 'domain', targetId: d.id, metadata: { name: d.name }, ip });
    const checks = await this.runChecks(d.id);
    return { verified: true, ...checks };
  }

  private async saveChecks(domainId: string, results: CheckResult[]) {
    const now = new Date();
    await this.prisma.$transaction(
      results.map((r) =>
        this.prisma.dnsCheck.upsert({
          where: { domainId_kind_host: { domainId, kind: r.kind, host: r.host } },
          update: { ...r, checkedAt: now },
          create: { domainId, ...r, checkedAt: now },
        }),
      ),
    );
  }

  /** Step 2: evaluates every mail record. Domain becomes ACTIVE only when all required checks pass. */
  async runChecks(domainId: string) {
    const d = await this.prisma.domain.findUniqueOrThrow({ where: { id: domainId } });
    if (!d.stalwartId || !d.verifiedAt) return { domain: d, checks: await this.prisma.dnsCheck.findMany({ where: { domainId } }) };
    const sd = await this.stalwart.getDomain(d.stalwartId, true);
    if (!sd) throw new NotFoundException('Domain is missing on the mail server — re-verify to provision it again');
    const zone = parseZoneFile(sd.dnsZoneFile ?? '');
    const results = await this.dns.checkMailRecords(d.name, zone, { mailHostname: this.cfg.MAIL_HOSTNAME, publicIp: this.cfg.MAIL_PUBLIC_IP });
    // Mail checks replace older ones (DKIM selectors rotate); the ownership record is kept.
    await this.prisma.dnsCheck.deleteMany({ where: { domainId, kind: { not: 'OWNERSHIP' } } });
    await this.saveChecks(domainId, results);
    const allPass = results.filter((r) => r.required).every((r) => r.status === 'PASS' || r.status === 'WARN');
    let status: DomainStatus = d.status;
    if (d.status !== 'SUSPENDED') status = allPass ? 'ACTIVE' : 'VERIFIED';
    const updated = await this.prisma.domain.update({
      where: { id: domainId },
      data: { status, lastCheckedAt: new Date(), mailReadyAt: allPass ? (d.mailReadyAt ?? new Date()) : null },
    });
    if (d.status === 'ACTIVE' && status === 'VERIFIED') {
      await this.prisma.securityEvent.create({
        data: { organizationId: d.organizationId, type: 'domain.dns_regressed', severity: 'WARNING', message: `DNS records for ${d.name} no longer pass all checks`, metadata: { failing: results.filter((r) => r.required && r.status === 'FAIL').map((r) => r.kind) } },
      });
    }
    return { domain: updated, checks: await this.prisma.dnsCheck.findMany({ where: { domainId }, orderBy: [{ required: 'desc' }, { kind: 'asc' }] }) };
  }

  /** Exact records the customer must publish, derived from Stalwart's computed zone. */
  async records(organizationId: string, id: string) {
    const d = await this.get(organizationId, id);
    const records: { purpose: string; type: string; host: string; value: string; priority?: number; required: boolean }[] = [
      { purpose: 'Ownership verification', type: 'TXT', host: ownershipHost(d.name), value: ownershipValue(d.verificationToken), required: true },
    ];
    let zoneFile: string | null = null;
    if (d.stalwartId) {
      const sd = await this.stalwart.getDomain(d.stalwartId, true);
      zoneFile = sd?.dnsZoneFile ?? null;
      for (const r of parseZoneFile(zoneFile ?? '')) {
        let purpose = 'Recommended';
        let required = false;
        let value = r.value;
        let priority: number | undefined;
        if (r.type === 'MX') {
          purpose = 'Incoming mail (MX)';
          required = true;
          const m = r.value.match(/^(\d+)\s+(.*)$/);
          if (m) {
            priority = Number(m[1]);
            value = m[2];
          }
        } else if (r.type === 'TXT' && r.value.startsWith('v=spf1')) {
          purpose = 'Sender authorisation (SPF)';
          required = true;
        } else if (r.host.includes('._domainkey.')) {
          purpose = 'Message signing (DKIM)';
          required = true;
        } else if (r.host.startsWith('_dmarc.')) {
          purpose = 'Policy (DMARC)';
          required = true;
        } else if (r.host.startsWith('_mta-sts.') || r.host.startsWith('mta-sts.')) purpose = 'MTA-STS (TLS policy)';
        else if (r.host.startsWith('_smtp._tls.')) purpose = 'TLS reporting';
        else if (r.type === 'SRV') purpose = 'Client autodiscovery (SRV)';
        else if (/^(autoconfig|autodiscover|ua-auto-config|_ua-auto-config)\./.test(r.host)) purpose = 'Client autoconfiguration';
        records.push({ purpose, type: r.type, host: r.host, value, priority, required });
      }
    }
    return { domain: d.name, provisioned: !!d.stalwartId, records, zoneFile };
  }

  async setCatchAll(p: Principal, organizationId: string, id: string, address: string | null, ip?: string) {
    const d = await this.get(organizationId, id);
    if (!d.stalwartId) throw new BadRequestException('Verify the domain first');
    if (address) {
      const owned =
        (await this.prisma.mailbox.findFirst({ where: { organizationId, address, status: { not: 'DELETED' } } })) ??
        (await this.prisma.alias.findFirst({ where: { organizationId, address } }));
      if (!owned) throw new BadRequestException('Catch-all must deliver to a mailbox or alias in your organisation');
    }
    await this.stalwart.updateDomain(d.stalwartId, { catchAllAddress: address });
    await this.prisma.domain.update({ where: { id }, data: { catchAllAddress: address } });
    await this.audit.record(p, { action: address ? 'domain.catch_all_set' : 'domain.catch_all_removed', organizationId, targetType: 'domain', targetId: id, metadata: { address }, ip });
    return { ok: true };
  }

  async setSuspended(p: Principal, organizationId: string, id: string, suspended: boolean, reason?: string, ip?: string) {
    const d = await this.get(organizationId, id);
    if (d.stalwartId) await this.stalwart.updateDomain(d.stalwartId, { enable: !suspended });
    const status: DomainStatus = suspended ? 'SUSPENDED' : d.mailReadyAt ? 'ACTIVE' : d.verifiedAt ? 'VERIFIED' : 'PENDING_VERIFICATION';
    await this.prisma.domain.update({ where: { id }, data: { status, suspendedReason: suspended ? (reason ?? null) : null } });
    await this.audit.record(p, { action: suspended ? 'domain.suspended' : 'domain.reactivated', organizationId, targetType: 'domain', targetId: id, metadata: { reason }, ip });
    return { ok: true, status };
  }

  /** Removal is refused while mailboxes still exist on the domain (data-loss safeguard). */
  async remove(p: Principal, organizationId: string, id: string, ip?: string) {
    const d = await this.get(organizationId, id);
    const mailboxes = await this.prisma.mailbox.count({ where: { domainId: id, status: { not: 'DELETED' } } });
    if (mailboxes) throw new BadRequestException(`Delete the ${mailboxes} mailbox(es) on ${d.name} before removing the domain`);
    if (d.stalwartId) {
      try {
        await this.stalwart.destroyDomain(d.stalwartId);
      } catch (e) {
        logger.warn({ err: (e as Error).message, domain: d.name }, 'Stalwart domain destroy failed');
        throw new BadRequestException(`Mail server refused to remove the domain: ${(e as Error).message}`);
      }
    }
    await this.prisma.domain.delete({ where: { id } });
    await this.audit.record(p, { action: 'domain.removed', organizationId, targetType: 'domain', targetId: id, metadata: { name: d.name }, ip });
    return { ok: true };
  }
}
