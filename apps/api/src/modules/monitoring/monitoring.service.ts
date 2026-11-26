import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { statfs } from 'node:fs/promises';
import os from 'node:os';
import { loadConfig } from '../../config/config';
import { logger } from '../../common/logger';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { StalwartClient } from '../stalwart/stalwart.client';

export const MAINTENANCE_QUEUE = 'jimail-maintenance';
export const WORKER_HEARTBEAT_KEY = 'jimail:worker:heartbeat';

export interface ComponentHealth {
  name: string;
  ok: boolean;
  latencyMs?: number;
  detail?: string;
}

@Injectable()
export class MonitoringService {
  private readonly cfg = loadConfig();
  private queue: Queue | null = null;
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly stalwart: StalwartClient,
  ) {}

  private getQueue() {
    this.queue ??= new Queue(MAINTENANCE_QUEUE, { connection: this.redis.client });
    return this.queue;
  }

  async components(): Promise<ComponentHealth[]> {
    const time = async (name: string, fn: () => Promise<unknown>): Promise<ComponentHealth> => {
      const t = Date.now();
      try {
        await fn();
        return { name, ok: true, latencyMs: Date.now() - t };
      } catch (e) {
        return { name, ok: false, latencyMs: Date.now() - t, detail: (e as Error).message };
      }
    };
    const [db, redis, stalwart] = await Promise.all([
      time('database', () => this.prisma.$queryRaw`SELECT 1`),
      time('redis', () => this.redis.client.ping()),
      this.stalwart.health().then((h) => ({ name: 'mail-server', ok: h.ok, latencyMs: h.latencyMs, detail: h.error })),
    ]);
    const hb = await this.redis.client.get(WORKER_HEARTBEAT_KEY).catch(() => null);
    const age = hb ? Date.now() - Number(hb) : null;
    const worker: ComponentHealth = { name: 'worker', ok: age !== null && age < 180_000, detail: age === null ? 'No heartbeat received' : `Last heartbeat ${Math.round(age / 1000)}s ago` };
    const api: ComponentHealth = { name: 'api', ok: true, detail: `uptime ${Math.round(process.uptime())}s` };
    return [api, db, redis, stalwart, worker];
  }

  async system() {
    let disk: { totalBytes: number; freeBytes: number; usedPercent: number } | null = null;
    try {
      const s = await statfs(this.cfg.DATA_DISK_PATH);
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      disk = { totalBytes: total, freeBytes: free, usedPercent: total ? Math.round(((total - free) / total) * 1000) / 10 : 0 };
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'statfs failed');
    }
    const mem = { totalBytes: os.totalmem(), freeBytes: os.freemem(), usedPercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 1000) / 10 };
    const cpus = os.cpus().length;
    const load = os.loadavg();
    return { host: os.hostname(), cpus, loadAvg: load, cpuLoadPercent: Math.round((load[0] / Math.max(cpus, 1)) * 1000) / 10, memory: mem, disk, process: { rssBytes: process.memoryUsage().rss, uptimeSec: Math.round(process.uptime()) } };
  }

  async jobs() {
    const q = this.getQueue();
    const [counts, failed] = await Promise.all([q.getJobCounts('active', 'completed', 'failed', 'delayed', 'waiting'), q.getFailed(0, 20)]);
    return { counts, recentFailures: failed.map((j) => ({ id: j.id, name: j.name, failedReason: j.failedReason, finishedOn: j.finishedOn, attemptsMade: j.attemptsMade })) };
  }

  /** Posts critical alerts to the configured webhook (Slack-compatible {"text": ...} payload). */
  async alert(title: string, detail: string) {
    logger.error({ alert: title, detail }, 'ALERT');
    await this.prisma.securityEvent.create({ data: { type: 'system.alert', severity: 'CRITICAL', message: `${title}: ${detail}` } }).catch(() => undefined);
    if (!this.cfg.ALERT_WEBHOOK_URL) return;
    try {
      await fetch(this.cfg.ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `[${this.cfg.APP_NAME}] ${title}: ${detail}`, title, detail, at: new Date().toISOString() }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'Alert webhook failed');
    }
  }
}
