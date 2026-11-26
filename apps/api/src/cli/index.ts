import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { loadConfig } from '../config/config';
import { PrismaService } from '../common/prisma.service';
import { AuthService } from '../modules/auth/auth.service';
import { BillingService } from '../modules/billing/billing.service';
import { StalwartClient } from '../modules/stalwart/stalwart.client';

/**
 * Operator CLI:
 *   node dist/cli/index.js create-admin <email> <name>        (password read from JIMAIL_ADMIN_PASSWORD)
 *   node dist/cli/index.js stalwart-bootstrap                 (configures a fresh Stalwart in bootstrap mode)
 *   node dist/cli/index.js stalwart-finalize                  (after restart: API key + ACME HTTP-01)
 *   node dist/cli/index.js stalwart-webhook                   (registers the delivery-event webhook)
 *   node dist/cli/index.js seed-plans
 */
async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'stalwart-bootstrap') return stalwartBootstrap();
  if (cmd === 'stalwart-finalize') return stalwartFinalize();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    if (cmd === 'create-admin') {
      const [email, ...nameParts] = args;
      const password = process.env.JIMAIL_ADMIN_PASSWORD;
      if (!email || !password) throw new Error('Usage: JIMAIL_ADMIN_PASSWORD=... create-admin <email> <name>');
      if (password.length < 12) throw new Error('Choose a password of at least 12 characters');
      const prisma = app.get(PrismaService);
      const hash = await app.get(AuthService).hashPassword(password);
      const user = await prisma.user.upsert({
        where: { email: email.toLowerCase() },
        update: { platformRole: 'SUPER_ADMIN', passwordHash: hash, emailVerifiedAt: new Date(), status: 'ACTIVE' },
        create: { email: email.toLowerCase(), name: nameParts.join(' ') || 'Administrator', passwordHash: hash, platformRole: 'SUPER_ADMIN', emailVerifiedAt: new Date() },
      });
      await prisma.auditLog.create({ data: { action: 'admin.created_via_cli', targetType: 'user', targetId: user.id } });
      console.log(`Super admin ready: ${user.email}. Sign in and enable two-factor authentication.`);
    } else if (cmd === 'stalwart-webhook') {
      const cfg = loadConfig();
      if (!cfg.STALWART_WEBHOOK_SECRET) throw new Error('STALWART_WEBHOOK_SECRET is not set');
      const url = process.env.STALWART_WEBHOOK_TARGET ?? 'http://api:4000/api/v1/stalwart/webhook';
      console.log(`Webhook ${await app.get(StalwartClient).ensureWebhook(url, cfg.STALWART_WEBHOOK_SECRET)} -> ${url}`);
    } else if (cmd === 'seed-plans') {
      await app.get(BillingService).ensurePlans();
      console.log('Plans ready');
    } else {
      console.log('Commands: create-admin <email> <name> | stalwart-bootstrap | stalwart-webhook | seed-plans');
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

async function stalwartJmap(url: string, auth: string, methodCalls: unknown[]) {
  const r = await fetch(`${url}/jmap/`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ using: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'], methodCalls }) });
  if (!r.ok) throw new Error(`Stalwart HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const res = ((await r.json()) as any).methodResponses as any[];
  for (const [name, args] of res) if (name === 'error') throw new Error(`Stalwart: ${args.description ?? args.type}`);
  return res;
}

/**
 * Step 1 — configures a Stalwart server that is still in bootstrap mode by submitting the Bootstrap
 * object (https://stalw.art/docs/configuration/bootstrap-mode/) with the recovery admin credential.
 * Stalwart stores its data in PostgreSQL (online backups with pg_dump). Prints the permanent admin
 * credential as JSON on stdout so the setup script can store it in a mode-600 file. Restart Stalwart after.
 */
async function stalwartBootstrap() {
  const url = (process.env.STALWART_URL ?? 'http://stalwart:8080').replace(/\/$/, '');
  const recovery = process.env.STALWART_RECOVERY_ADMIN;
  const hostname = process.env.MAIL_HOSTNAME;
  const domain = process.env.STALWART_DEFAULT_DOMAIN || hostname?.split('.').slice(1).join('.');
  if (!recovery || !hostname || !domain) throw new Error('STALWART_RECOVERY_ADMIN and MAIL_HOSTNAME are required');
  const store = process.env.STALWART_DATA_STORE ?? 'postgres';
  const dataStore =
    store === 'rocksdb'
      ? { '@type': 'RocksDb', path: '/var/lib/stalwart/' }
      : { '@type': 'PostgreSql', host: process.env.STALWART_DB_HOST ?? 'postgres', port: 5432, database: 'stalwart', authUsername: 'stalwart', authSecret: { '@type': 'EnvironmentVariable', variableName: 'STALWART_DB_PASSWORD' } };
  const res = await stalwartJmap(url, `Basic ${Buffer.from(recovery).toString('base64')}`, [
    [
      'x:Bootstrap/set',
      {
        update: {
          singleton: {
            defaultHostname: hostname,
            defaultDomain: domain,
            requestTlsCertificate: process.env.STALWART_ACME !== 'false',
            generateDkimKeys: true,
            dataStore,
            tracer: { '@type': 'Stdout', ansi: false, level: 'info' },
          },
        },
      },
      'b',
    ],
  ]);
  const r = res[0][1];
  if (r.notUpdated?.singleton) throw new Error(`Bootstrap rejected: ${JSON.stringify(r.notUpdated.singleton)}`);
  const creds = r.updated.singleton as { username: string; secret: string };
  process.stdout.write(JSON.stringify({ username: creds.username, password: creds.secret }) + '\n');
}

/**
 * Step 2 — after the restart: creates the admin API key JiMail uses and switches ACME to HTTP-01
 * (Caddy owns port 443 and forwards /.well-known/acme-challenge/ for the mail hostname to Stalwart).
 * Prints the API key on stdout.
 */
async function stalwartFinalize() {
  const url = (process.env.STALWART_URL ?? 'http://stalwart:8080').replace(/\/$/, '');
  const user = process.env.STALWART_ADMIN_USER;
  const pass = process.env.STALWART_ADMIN_PASSWORD;
  if (!user || !pass) throw new Error('STALWART_ADMIN_USER and STALWART_ADMIN_PASSWORD are required');
  const auth = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  const acme = await stalwartJmap(url, auth, [
    ['x:AcmeProvider/query', { filter: {} }, 'q'],
  ]);
  for (const id of acme[0][1].ids as string[]) {
    await stalwartJmap(url, auth, [['x:AcmeProvider/set', { update: { [id]: { challengeType: 'Http01' } } }, 'u']]);
  }
  const [[, k]] = await stalwartJmap(url, auth, [
    ['x:ApiKey/set', { create: { k: { description: 'JiMail platform (server-side)', permissions: { '@type': 'Inherit' }, allowedIps: {} } } }, 'c'],
  ]);
  if (k.notCreated?.k) throw new Error(`API key not created: ${JSON.stringify(k.notCreated.k)}`);
  await stalwartJmap(url, auth, [['x:Action/set', { create: { a: { '@type': 'ReloadSettings' } } }, 'r']]).catch(() => undefined);
  process.stdout.write(`${k.created.k.secret}\n`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
