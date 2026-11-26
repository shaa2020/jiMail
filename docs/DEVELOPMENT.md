# Development

## Prerequisites

Node.js 22, pnpm 10, Docker, PostgreSQL 16+ and Redis 7 (local or containers).

## Setup

```bash
pnpm install
eval "$(./scripts/dev-stalwart.sh)"            # starts + bootstraps Stalwart on :18080
cp apps/api/.env.example apps/api/.env          # add APP_SECRET, APP_ENCRYPTION_KEY, STALWART_API_KEY
createdb jimail                                 # or use a container
pnpm --filter @jimail/api exec prisma migrate deploy
node apps/api/test/support/fake-dns.js 5353 /tmp/fakedns.json &   # test DNS (DNS_RESOLVERS=127.0.0.1:5353)
pnpm dev:api
API_PROXY_TARGET=http://localhost:4000 pnpm dev:web
JIMAIL_ADMIN_PASSWORD='...' node apps/api/dist/cli/index.js create-admin admin@jimail.test Admin
```

With the fake DNS server, publish records for a test domain by editing `/tmp/fakedns.json`, e.g. `{"_jimail.acme.test|TXT": ["jimail-verification=..."]}`. System emails are written to `/tmp/jimail-outbox` (`MAIL_TRANSPORT=file`).

Stalwart's webhook targets the API at `http://172.17.0.1:4000` (Docker bridge gateway) in development.

## Layout

```
apps/api      NestJS API, worker, CLI, Prisma schema & migrations, tests
apps/web      Next.js app (app router), Playwright e2e tests
infra         Caddyfile, PostgreSQL init script
scripts       jimail (operations), dev-stalwart.sh
docs          documentation
```

## Conventions

- Every organisation route lives under `/orgs/:orgId/...` and declares `@OrgRoles(minRole)` (and `@Scopes(...)` if API keys may use it). Services always filter by `organizationId`.
- Validate input with zod (`ZodPipe`) and document it with `ApiZodBody` / `ApiZodQuery`.
- Record administrative mutations with `AuditService.record`.
- Stalwart calls go through `StalwartClient`; verify new request shapes against https://stalw.art/docs/ref/ and a running server, and add an integration test.
- Schema changes: `pnpm --filter @jimail/api exec prisma migrate dev --name <change>`; never edit production databases by hand.
