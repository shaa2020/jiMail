# Architecture

## Components

```
                 Internet
        ┌───────────┴─────────────────────────────┐
   80/443 (HTTPS)                     25 · 465 · 993 · 995 · 4190
        │                                         │
   ┌────▼────┐   APP_DOMAIN    ┌─────────┐        │
   │  Caddy  ├────────────────►│   web   │ Next.js (UI only, no secrets)
   │         ├──── /api/* ────►│   api   │ NestJS REST API
   │         │                 └────┬────┘
   │         │  MAIL_HOSTNAME,       │  JMAP management (admin API key)
   │         │  autoconfig.*  ┌──────▼──────┐
   │         ├───────────────►│  Stalwart   │◄─────── SMTP/IMAP/POP3 clients, other MTAs
   └─────────┘  (:8080 int.)  └──────┬──────┘
                                     │ data + blob store
   ┌────────┐   ┌────────┐    ┌──────▼──────┐
   │ worker ├──►│ Redis  │    │ PostgreSQL  │  databases: jimail, stalwart
   └───┬────┘   └────────┘    └─────────────┘
       └── BullMQ jobs: DNS re-checks, usage sync, billing lifecycle, snapshots, cleanup, health alerts
```

| Service | Responsibility |
|---|---|
| **web** | Next.js app: marketing page, auth flows, super admin console, organisation dashboard, webmail. Talks only to `/api/v1` on the same origin. |
| **api** | All business logic, authorisation and tenant isolation. The only component holding Stalwart credentials. |
| **worker** | Same image as the API; runs scheduled jobs with BullMQ and posts alerts. |
| **Stalwart** | Mail protocols, storage, DKIM keys/signing, spam filtering, queue, TLS for mail ports. |
| **PostgreSQL** | `jimail` database (platform data) and `stalwart` database (all mail data, so both can be backed up online with `pg_dump`). |
| **Redis** | Rate limits, BullMQ queues, small caches. |
| **Caddy** | TLS termination and routing; forwards ACME HTTP-01 challenges for the mail hostname to Stalwart; on-demand certificates for customer `autoconfig.`/`mta-sts.` hostnames, allowed only for verified domains. |

## Stalwart integration

Stalwart v1 exposes management as JMAP objects (`x:Domain`, `x:Account`, `x:ApiKey`, `x:MailRule`, `x:WebHook`, `x:QueuedMessage`, `x:Bootstrap`, …) on `/jmap/` with the `urn:stalwart:jmap` capability ([reference](https://stalw.art/docs/ref/)). Every request shape used by JiMail was verified against a running Stalwart 1.2.1 before being implemented; the integration test suite exercises them against a real server.

| JiMail action | Stalwart call |
|---|---|
| Provision verified domain (DKIM auto-generated) | `x:Domain/set create` with `dkimManagement: Automatic` |
| DNS records to publish | `x:Domain/get` → `dnsZoneFile` (parsed; never invented) |
| Create mailbox | `x:Account/set create` (`@type: User`, password credential, quota) |
| Per-mailbox webmail credential | `x:ApiKey/set` with `accountId` (impersonation) — stored AES-256-GCM encrypted |
| Suspend / reactivate | `permissions: Merge` with `authenticate`, `emailReceive`, `emailSend` disabled / `Inherit` |
| Password reset | patch `credentials/0/secret` |
| Aliases | patch `aliases/<position>` |
| Forwarding | `x:MailRule` with `redirect` action on the account |
| Catch-all | `x:Domain` `catchAllAddress` |
| Delivery events | `x:WebHook` (HMAC-SHA256 signed) → `POST /api/v1/stalwart/webhook` |
| Queue | `x:QueuedMessage/query+get` |
| Usage | `x:Account/get` `usedDiskQuota` |
| Webmail | Standard JMAP Mail/Submission/VacationResponse/Contacts with the mailbox's own key |
| First-time setup | `x:Bootstrap/set` (headless), `x:AcmeProvider` (HTTP-01), `x:ApiKey` |

Notes discovered during integration: lists/sets are JSON objects, not arrays; `cc: null` is rejected on `Email/set`; telemetry webhook changes require `x:Action ReloadSettings`.

## Tenancy model

- Every tenant-owned table carries `organizationId`. Domains and addresses are globally unique.
- Organisation routes are all shaped `/orgs/:orgId/...`. The global `OrgGuard` resolves the caller's membership and minimum role (`OWNER > ADMIN > MAILBOX_ADMIN > MEMBER`) before any handler runs; non-members get **404** (no existence disclosure).
- Services additionally scope every query by `organizationId` (`findFirst({ where: { id, organizationId } })`), so an object ID from another tenant is never found even if a guard were misconfigured.
- API keys are bound to one organisation and a scope list; they cannot reach personal, webmail or platform-admin routes.
- Webmail access is explicit: `MailboxAccess(userId, mailboxId)`. Mailbox users are JiMail users with `authSource=MAILBOX` whose password is verified by Stalwart — one password for webmail and mail apps.
- Platform super admins can enter any organisation; every action is audited.

Tenant isolation is covered by the integration tests (cross-tenant reads, writes, ID reuse, domain claims, API keys).

## Data model (main tables)

`User`, `Membership`, `Session`, `UserToken`, `RecoveryCode`, `LoginEvent`, `Organization`, `Invitation`, `Domain`, `DnsCheck`, `Mailbox`, `Alias`, `MailboxAccess`, `Plan`, `Subscription`, `Invoice`, `Payment`, `BillingEvent`, `ApiKey`, `AuditLog`, `SecurityEvent`, `DeliveryEvent`, `UsageSnapshot`, `Notification`, `SystemSetting`. See `apps/api/prisma/schema.prisma`. Mail content is never stored in the JiMail database.

## Key engineering decisions

1. **Stalwart owns mail; JiMail owns the platform.** No protocol code in JiMail.
2. **Curated webmail endpoints, not a raw JMAP proxy.** The browser never sees a Stalwart credential and can only invoke vetted operations.
3. **Domains are provisioned in Stalwart only after DNS ownership proof**, so a tenant cannot claim a domain it does not control (which would hijack local delivery).
4. **DNS instructions come from Stalwart's computed zone**, so DKIM selectors and keys are always exact.
5. **PostgreSQL as Stalwart's data store** — consistent online backups with `pg_dump`, one database engine to operate.
6. **Opaque, hashed session tokens + CSRF double-submit** instead of JWTs: instant revocation, session listing, rotation.
7. **Validation with zod**, also emitted into the OpenAPI document.
8. **NestJS 11 (maintained LTS line)** rather than the brand-new 12, TypeScript 5.9 rather than the Go-based 7.0, Prisma 6 rather than 7 — chosen for ecosystem stability at the time of writing.
