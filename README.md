# JiMail

**Your email. Your domain. Your control.**

JiMail is a self-hosted, multi-tenant email hosting platform. Organisations connect domains they own, create mailboxes, and use them in the JiMail webmail or any IMAP/SMTP app. Mail protocols, storage, DKIM signing and spam filtering are handled by [Stalwart Mail Server](https://stalw.art) v1; JiMail provides everything around it: customer accounts, organisations, domain onboarding with DNS verification, mailbox provisioning, webmail, administration, billing, API and operations.

| | |
|---|---|
| **Web app** | Next.js 16 · React 19 · Tailwind CSS 4 · TanStack Query · Radix UI |
| **API & worker** | NestJS 11 · TypeScript 5.9 · Prisma 6 · PostgreSQL 17 · Redis 7 · BullMQ |
| **Mail server** | Stalwart v1 (SMTP, IMAP, POP3, JMAP, CalDAV, CardDAV) managed over its JMAP management API |
| **Edge** | Caddy 2 (automatic HTTPS) |
| **Deployment** | Docker Compose on one VPS; images build from this repository |

## Contents

- [Quick start (production)](#quick-start-production)
- [Daily operations](#daily-operations)
- [Development](#development)
- [Documentation](#documentation)
- [Known limitations](#known-limitations)
- [External services and credentials you must provide](#external-services-and-credentials-you-must-provide)

## Quick start (production)

Requirements: a VPS with a **static public IPv4**, **outbound and inbound TCP port 25 allowed** by your provider, Docker Engine 24+ with the Compose plugin, `openssl`, `git`, and two DNS names pointing at the server (for example `app.example.com` and `mail.example.com`). Minimum 2 vCPU / 4 GB RAM / 40 GB SSD — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#server-sizing).

```bash
git clone https://github.com/shaa2020/jimail.git && cd jimail

# 1. Generate secrets and create .env (mode 600)
./scripts/jimail init

# 2. Edit .env: set APP_DOMAIN, MAIL_HOSTNAME, MAIL_PUBLIC_IP and ACME_EMAIL
nano .env

# 3. Build and start PostgreSQL, Redis, Stalwart, API, worker, web and Caddy
./scripts/jimail up

# 4. Configure Stalwart headlessly (bootstrap → permanent config → API key → delivery webhook)
./scripts/jimail setup-mail

# 5. Create the first platform administrator (prompts for a password)
./scripts/jimail create-admin you@example.com "Your Name"
```

Then:

1. Ask your hosting provider to set the **reverse DNS (PTR)** of the server IP to `MAIL_HOSTNAME`.
2. Open `https://APP_DOMAIN`, sign in and **enable two-factor authentication** (required for platform administrators).
3. Configure outgoing system mail (verification and password-reset emails): create a mailbox such as `no-reply@yourdomain` through JiMail, put its credentials in `SMTP_*` in `.env`, then `docker compose --env-file .env up -d api worker`.
4. Open **Deliverability** in the admin console and resolve every failing check.

Full guide including DNS records, TLS and firewall: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Daily operations

| Task | Command |
|---|---|
| Start / rebuild | `./scripts/jimail up` |
| Stop (data kept) | `./scripts/jimail down` |
| Status and health | `./scripts/jimail status` |
| Logs | `./scripts/jimail logs [api|worker|web|stalwart|caddy|postgres]` |
| Encrypted backup | `./scripts/jimail backup` |
| Verify a backup (decrypt + test restore) | `./scripts/jimail verify-backup backups/<file>` |
| Restore | `./scripts/jimail restore backups/<file>` |
| Update to the latest version | `./scripts/jimail update` (pulls, backs up, rebuilds, migrates, restarts) |
| Add a platform admin | `./scripts/jimail create-admin <email> "<name>"` |

Schedule backups with cron, for example `17 3 * * * cd /opt/jimail && ./scripts/jimail backup >> /var/log/jimail-backup.log 2>&1`, and copy `backups/` off the server. See [docs/BACKUP.md](docs/BACKUP.md).

Database migrations run automatically (`migrate` service) on every start.

## Development

```bash
pnpm install
eval "$(./scripts/dev-stalwart.sh)"     # throwaway Stalwart on :18080, prints STALWART_URL / STALWART_API_KEY
cp apps/api/.env.example apps/api/.env  # fill in secrets + the two values above
pnpm --filter @jimail/api exec prisma migrate deploy
pnpm dev:api                             # API on :4000
API_PROXY_TARGET=http://localhost:4000 pnpm dev:web   # web on :3000
```

Tests: `pnpm --filter @jimail/api test:unit`, `pnpm --filter @jimail/api test:integration` (needs PostgreSQL, Redis and the dev Stalwart), `pnpm test:e2e` (needs the running stack). Details: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) and [docs/TESTING.md](docs/TESTING.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data model, tenancy model, Stalwart integration, key engineering decisions |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | VPS setup, DNS records, TLS, firewall, sizing and scaling |
| [docs/DOMAINS.md](docs/DOMAINS.md) | Customer domain onboarding and the DNS records JiMail checks |
| [docs/SECURITY.md](docs/SECURITY.md) | Security architecture and the tested security checklist |
| [docs/BACKUP.md](docs/BACKUP.md) | Backup, restore and disaster recovery |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Monitoring, alerting, updates, troubleshooting |
| [docs/API.md](docs/API.md) | REST API, API keys and scopes (interactive reference at `/api/docs`) |
| [docs/TESTING.md](docs/TESTING.md) | Test strategy and the testing report |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local development |
| [docs/LIMITATIONS.md](docs/LIMITATIONS.md) | Known limitations and what still needs external setup |

## Known limitations

Summary (full list in [docs/LIMITATIONS.md](docs/LIMITATIONS.md)):

- **Public mail delivery was not tested from the build environment** (no public IP, port 25 or public DNS). All mail flows were tested end-to-end between mailboxes on a real Stalwart server; DNS checks were tested against an authoritative test DNS server. Follow the go-live checklist in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#go-live-checklist).
- **Calendar**: calendars and contacts sync over CalDAV/CardDAV to standard apps; the webmail has a Contacts UI but **no web calendar UI** yet.
- **Stripe** integration is implemented (checkout, portal, signed webhooks) but was not exercised against Stripe's live API.
- **Deleted mailboxes cannot be restored** in JiMail (Stalwart's account archive is an Enterprise feature); deletion requires typing the address.
- JiMail encrypts mail in transit (TLS). It does **not** provide end-to-end encryption.

## External services and credentials you must provide

| What | Why | Where |
|---|---|---|
| VPS with static IPv4, port 25 open | Sending/receiving mail | Hosting provider |
| DNS records for `APP_DOMAIN`, `MAIL_HOSTNAME` | Web app and mail host | Your DNS provider |
| Reverse DNS (PTR) for the server IP | Deliverability | Hosting provider |
| `ACME_EMAIL` | Let's Encrypt certificates (automatic) | `.env` |
| SMTP credentials (`SMTP_*`) | Verification, reset and invitation emails | `.env` (a JiMail mailbox works) |
| Stripe secret + webhook secret (optional) | Online payments | `.env`, Stripe dashboard webhook → `https://APP_DOMAIN/api/v1/billing/stripe/webhook` |
| Alert webhook URL (optional) | Critical alerts (Slack-compatible) | `.env` |
| Off-site backup storage | Disaster recovery | Copy `backups/` (for example with rclone/restic) |

## Licence

Proprietary — all rights reserved by the JiMail owner. Stalwart Mail Server is licensed separately by Stalwart Labs (AGPL-3.0 / commercial); review its licence for your hosting model.
