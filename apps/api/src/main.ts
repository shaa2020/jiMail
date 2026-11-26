import 'reflect-metadata';
import { loadConfig } from './config/config';
import { logger } from './common/logger';
import { createApp } from './bootstrap';
import { BillingService } from './modules/billing/billing.service';

async function main() {
  const cfg = loadConfig();
  const app = await createApp();
  await app.get(BillingService).ensurePlans();
  app.enableShutdownHooks();
  await app.listen(cfg.PORT, '0.0.0.0');
  logger.info({ port: cfg.PORT, env: cfg.NODE_ENV }, 'JiMail API listening');
}

main().catch((err) => {
  logger.fatal({ err: err.message }, 'Failed to start');
  process.exit(1);
});
