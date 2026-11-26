import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Public URL of the JiMail web app, e.g. https://app.example.com — used in emailed links. */
  APP_URL: z.url(),
  /** Allowed browser origins (comma separated). Defaults to APP_URL. */
  CORS_ORIGINS: z.string().optional(),
  /** Product name override (white-label). */
  APP_NAME: z.string().default('JiMail'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

  /** 32-byte key, base64 encoded. Encrypts TOTP secrets and per-mailbox Stalwart credentials. */
  APP_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'APP_ENCRYPTION_KEY must be 32 bytes base64'),
  /** Secret mixed into token hashes (sessions, API keys). */
  APP_SECRET: z.string().min(32),

  SESSION_TTL_HOURS: z.coerce.number().default(24 * 7),
  SESSION_IDLE_TIMEOUT_HOURS: z.coerce.number().default(24),
  COOKIE_SECURE: bool.default(true),
  COOKIE_DOMAIN: z.string().optional(),
  TRUST_PROXY: z.string().default('loopback, linklocal, uniquelocal'),

  /** Allow anyone to register a new organisation. */
  ALLOW_SIGNUP: bool.default(true),

  // ── Stalwart ──
  STALWART_URL: z.url().default('http://stalwart:8080'),
  /** Admin API key (API_...) created during setup. Never sent to the browser. */
  STALWART_API_KEY: z.string().optional(),
  STALWART_WEBHOOK_SECRET: z.string().optional(),
  /** Public mail server hostname: MX target and IMAP/SMTP host shown to customers. */
  MAIL_HOSTNAME: z.string().min(1),
  /** Public IPv4/IPv6 of the mail server (used for SPF/PTR readiness checks). */
  MAIL_PUBLIC_IP: z.string().optional(),
  IMAP_PORT: z.coerce.number().default(993),
  SMTP_SUBMISSION_PORT: z.coerce.number().default(465),
  SMTP_STARTTLS_PORT: z.coerce.number().optional(),
  POP3_PORT: z.coerce.number().default(995),

  // ── DNS ──
  DNS_RESOLVERS: z.string().default('1.1.1.1,8.8.8.8'),

  // ── System mail (verification / reset emails) ──
  MAIL_TRANSPORT: z.enum(['smtp', 'file']).default('smtp'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(465),
  SMTP_SECURE: bool.default(true),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default('JiMail <no-reply@localhost>'),
  SMTP_TLS_REJECT_UNAUTHORIZED: bool.default(true),
  MAIL_FILE_DIR: z.string().default('./var/outbox'),

  // ── Billing ──
  BILLING_PROVIDER: z.enum(['none', 'stripe']).default('none'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  BILLING_GRACE_DAYS: z.coerce.number().default(7),

  // ── Abuse ──
  ABUSE_AUTO_SUSPEND: bool.default(true),
  ABUSE_FAILED_DELIVERY_THRESHOLD: z.coerce.number().default(50),

  // ── Monitoring ──
  ALERT_WEBHOOK_URL: z.string().optional(),
  DATA_DISK_PATH: z.string().default('/'),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid JiMail configuration:\n${issues}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === 'production') {
    if (c.MAIL_TRANSPORT === 'file') throw new Error('MAIL_TRANSPORT=file is not allowed in production');
    if (!c.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
    if (!c.STALWART_API_KEY) throw new Error('STALWART_API_KEY is required in production');
  }
  cached = c;
  return c;
}

export function resetConfigCache() {
  cached = null;
}
