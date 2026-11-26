import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { readFile, writeFile } from 'node:fs/promises';
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
 *   node dist/cli/index.js stalwart-webhook                   (registers the delivery-event webhook)
 *   node dist/cli/index.js seed-plans
 */
async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'stalwart-bootstrap') return stalwartBootstrap();
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

/**
 * Configures a Stalwart server that is still in bootstrap mode, using the recovery admin credential
 * (STALWART_RECOVERY_ADMIN=admin:<password>) and writes the resulting admin API key to the env file.
 * Steps follow https://stalw.art/docs/configuration/bootstrap-mode/.
 */
async function stalwartBootstrap() {
  const url = (process.env.STALWART_URL ?? 'http://stalwart:8080').replace(/\/$/, '');
  const recovery = process.env.STALWART_RECOVERY_ADMIN;
  const hostname = process.env.MAIL_HOSTNAME;
  const domain = process.env.STALWART_DEFAULT_DOMAIN ?? hostname?.split('.').slice(1).join('.');
  const envFile = process.env.ENV_FILE;
  if (!recovery || !hostname || !domain) throw new Error('STALWART_RECOVERY_ADMIN, MAIL_HOSTNAME (and optionally STALWART_DEFAULT_DOMAIN) are required');
  const basic = `Basic ${Buffer.from(recovery).toString('base64')}`;
  const jmap = async (auth: string, methodCalls: unknown[]) => {
    const r = await fetch(`${url}/jmap/`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ using: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'], methodCalls }) });
    if (!r.ok) throw new Error(`Stalwart HTTP ${r.status}: ${await r.text()}`);
    return ((await r.json()) as any).methodResponses as any[];
  };
  const [[name, res]] = await jmap(basic, [
    ['x:Bootstrap/set', { update: { singleton: { defaultHostname: hostname, defaultDomain: domain, requestTlsCertificate: process.env.STALWART_ACME !== 'false', generateDkimKeys: true, tracer: { '@type': 'Stdout', ansi: false, level: 'info' } } } }, 'b'],
  ]);
  if (name === 'error' || res.notUpdated) throw new Error(`Bootstrap failed: ${JSON.stringify(res)}`);
  const creds = res.updated.singleton as { username: string; secret: string };
  console.log(`Stalwart configured. Administrator account: ${creds.username} (password not printed).`);
  console.log('Restart the Stalwart container now, then re-run this command with --api-key to create the JiMail API key.');
  if (envFile) {
    const env = await readFile(envFile, 'utf8').catch(() => '');
    const add = `\n# Written by stalwart-bootstrap\nSTALWART_ADMIN_USER=${creds.username}\nSTALWART_ADMIN_PASSWORD=${creds.secret}\n`;
    await writeFile(envFile, env + add, { mode: 0o600 });
    console.log(`Credentials appended to ${envFile} (mode 600).`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
