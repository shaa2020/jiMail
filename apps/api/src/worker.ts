import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { AppModule } from './app.module';
import { loadConfig } from './config/config';
import { logger } from './common/logger';
import { PrismaService } from './common/prisma.service';
import { BillingService } from './modules/billing/billing.service';
import { DomainsService } from './modules/domains/domains.service';
import { MailboxesService } from './modules/mailboxes/mailboxes.service';
import { MAINTENANCE_QUEUE, MonitoringService, WORKER_HEARTBEAT_KEY } from './modules/monitoring/monitoring.service';
import { StalwartClient } from './modules/stalwart/stalwart.client';

/**
 * Background worker: DNS re-checks, usage sync, billing lifecycle, usage snapshots,
 * cleanup of expired sessions/tokens and health alerting. Runs as its own container.
 */
async function main() {
  const cfg = loadConfig();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const domains = app.get(DomainsService);
  const mailboxes = app.get(MailboxesService);
  const billing = app.get(BillingService);
  const monitoring = app.get(MonitoringService);
  const stalwart = app.get(StalwartClient);
  await billing.ensurePlans();

  const connection = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue(MAINTENANCE_QUEUE, { connection });
  const defaults = { removeOnComplete: { count: 200 }, removeOnFail: { count: 500 }, attempts: 3, backoff: { type: 'exponential' as const, delay: 30_000 } };
  await queue.upsertJobScheduler('dns-recheck', { every: 30 * 60_000 }, { name: 'dns-recheck', opts: defaults });
  await queue.upsertJobScheduler('usage-sync', { every: 15 * 60_000 }, { name: 'usage-sync', opts: defaults });
  await queue.upsertJobScheduler('billing-lifecycle', { every: 60 * 60_000 }, { name: 'billing-lifecycle', opts: defaults });
  await queue.upsertJobScheduler('usage-snapshot', { pattern: '17 2 * * *' }, { name: 'usage-snapshot', opts: defaults });
  await queue.upsertJobScheduler('cleanup', { pattern: '43 3 * * *' }, { name: 'cleanup', opts: defaults });
  await queue.upsertJobScheduler('health-check', { every: 5 * 60_000 }, { name: 'health-check', opts: { ...defaults, attempts: 1 } });
  await queue.upsertJobScheduler('webhook-ensure', { every: 6 * 60 * 60_000 }, { name: 'webhook-ensure', opts: defaults });

  const handlers: Record<string, () => Promise<unknown>> = {
    'dns-recheck': async () => {
      // Pending domains: look for the ownership record. Verified domains: re-validate mail records.
      const pending = await prisma.domain.findMany({ where: { status: 'PENDING_VERIFICATION', createdAt: { gt: new Date(Date.now() - 14 * 86400_000) } } });
      for (const d of pending) await domains.verifyOwnership(undefined, d.organizationId, d.id).catch((e) => logger.warn({ err: e.message, domain: d.name }, 'ownership check failed'));
      const verified = await prisma.domain.findMany({ where: { status: { in: ['VERIFIED', 'ACTIVE'] }, stalwartId: { not: null } } });
      for (const d of verified) await domains.runChecks(d.id).catch((e) => logger.warn({ err: e.message, domain: d.name }, 'dns check failed'));
      return { pending: pending.length, verified: verified.length };
    },
    'usage-sync': () => mailboxes.syncUsage(),
    'billing-lifecycle': () => billing.runLifecycle(),
    'usage-snapshot': async () => {
      const orgs = await prisma.organization.findMany({ where: { deletedAt: null }, select: { id: true } });
      for (const o of orgs) {
        const [agg, doms] = await Promise.all([
          prisma.mailbox.aggregate({ where: { organizationId: o.id, status: { not: 'DELETED' } }, _count: true, _sum: { usedBytes: true } }),
          prisma.domain.count({ where: { organizationId: o.id } }),
        ]);
        await prisma.usageSnapshot.create({ data: { organizationId: o.id, mailboxes: agg._count, domains: doms, storageBytes: agg._sum.usedBytes ?? BigInt(0) } });
      }
      return { orgs: orgs.length };
    },
    cleanup: async () => {
      const now = new Date();
      const old = new Date(Date.now() - 30 * 86400_000);
      const [s, t, l, d] = await Promise.all([
        prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: old } }] } }),
        prisma.userToken.deleteMany({ where: { expiresAt: { lt: old } } }),
        prisma.loginEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 180 * 86400_000) } } }),
        prisma.deliveryEvent.deleteMany({ where: { occurredAt: { lt: new Date(Date.now() - 90 * 86400_000) } } }),
      ]);
      await prisma.invitation.updateMany({ where: { status: 'PENDING', expiresAt: { lt: now } }, data: { status: 'EXPIRED' } });
      return { sessions: s.count, tokens: t.count, loginEvents: l.count, deliveryEvents: d.count };
    },
    'health-check': async () => {
      const comps = await monitoring.components();
      const failing = comps.filter((c) => !c.ok && c.name !== 'worker');
      const sys = await monitoring.system();
      if (failing.length) await monitoring.alert('Component failure', failing.map((f) => `${f.name}: ${f.detail ?? 'down'}`).join('; '));
      if (sys.disk && sys.disk.usedPercent > 90) await monitoring.alert('Disk almost full', `${sys.disk.usedPercent}% used on ${cfg.DATA_DISK_PATH}`);
      return { failing: failing.length };
    },
    'webhook-ensure': async () => {
      if (!stalwart.configured || !cfg.STALWART_WEBHOOK_SECRET) return { skipped: true };
      const url = process.env.STALWART_WEBHOOK_TARGET ?? 'http://api:4000/api/v1/stalwart/webhook';
      return { id: await stalwart.ensureWebhook(url, cfg.STALWART_WEBHOOK_SECRET) };
    },
  };

  const worker = new Worker(
    MAINTENANCE_QUEUE,
    async (job) => {
      const fn = handlers[job.name];
      if (!fn) throw new Error(`Unknown job ${job.name}`);
      const t = Date.now();
      const result = await fn();
      logger.info({ job: job.name, ms: Date.now() - t, result }, 'job completed');
      return result;
    },
    { connection: new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null }), concurrency: 2 },
  );
  worker.on('failed', (job, err) => {
    logger.error({ job: job?.name, err: err.message, attempts: job?.attemptsMade }, 'job failed');
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) void monitoring.alert(`Background job ${job.name} failed`, err.message);
  });

  const beat = () => connection.set(WORKER_HEARTBEAT_KEY, String(Date.now()), 'EX', 600).catch(() => undefined);
  await beat();
  const hb = setInterval(beat, 30_000);
  // Ensure the webhook right away on start.
  await queue.add('webhook-ensure', {}, defaults);
  logger.info('JiMail worker started');

  const shutdown = async () => {
    clearInterval(hb);
    await worker.close();
    await queue.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.fatal({ err: err.message }, 'Worker failed to start');
  process.exit(1);
});
