# Security

## Architecture

| Area | Implementation |
|---|---|
| Passwords | Argon2id (19 MiB, t=2), transparent rehash on login; policy ≥10 chars with mixed case + digit. Mailbox passwords live only in Stalwart. |
| Sessions | 256-bit random token in an `HttpOnly; Secure; SameSite=Lax` cookie, stored as HMAC-SHA256 hash. Absolute TTL (7 days) + idle timeout (24 h), revocable, listed per device, rotated after 2FA and password change. |
| CSRF | Per-session token; every non-GET request must echo it in `X-CSRF-Token` (double submit). |
| 2FA | RFC 6238 TOTP (secret AES-256-GCM encrypted), 10 single-use recovery codes (hashed). Org policy can require 2FA; platform admins are prompted and need 2FA before granting the role to others. |
| Brute force | Redis rate limits per IP and per account on login, MFA, registration, reset and resend; account lock after 10 failures for 15 min; timing-equalised unknown-user path; generic error messages. |
| Suspicious logins | New IP compared with 90 days of successful sign-ins → notification + email. |
| Authorisation | Global `AuthGuard` + `OrgGuard` (membership + minimum role per route), service-level `organizationId` scoping, 404 for foreign tenants. |
| API keys | `jm_live_` + 240-bit secret, stored hashed, scoped, expiring, rotatable, organisation-bound, 600 req/min limit, last-use tracking, all actions audited. |
| Input | zod validation on every body/query; Prisma parameterised queries (one raw query uses tagged-template parameters). |
| Output/XSS | React escaping; email HTML sanitised server-side (allow-list, no scripts/handlers/forms/iframes/`javascript:`/CSS `url()`), remote images blocked by default, links `noopener noreferrer`, deceptive links flagged, rendered in a sandboxed iframe without `allow-scripts` and with its own CSP. |
| Attachments | Served as `application/octet-stream` + `Content-Disposition: attachment` + `nosniff` + sandbox CSP; only images/plain text can be previewed; risky extensions are flagged and need confirmation. |
| HTTP headers | Helmet on the API (CSP `default-src 'none'`, HSTS, frame-ancestors none); Next.js CSP, `X-Frame-Options: DENY`, `nosniff`, referrer and permissions policies; Caddy HSTS. |
| Secrets | Only in `.env` (mode 600) / environment; never in Git; Stalwart DB password passed by env-var reference; logger redacts passwords, tokens, cookies, keys. |
| Stalwart | Admin API key server-side only; HTTP listener not published; `/admin` blocked at Caddy; recovery admin removed after setup; per-mailbox keys AES-256-GCM encrypted. |
| Mail abuse | Authenticated submission only (no open relay — Stalwart default, verified); per-mailbox hourly send limit in webmail; webhook-driven detection of bursts/failed deliveries → automatic block of sending + admin alert; admin suspension. |
| Webhooks | Stalwart events HMAC-SHA256 verified (`X-Signature`); Stripe signature + timestamp tolerance; idempotent event storage. |
| Certificates | On-demand TLS only for verified customer domains (prevents certificate-issuance abuse). |
| Audit | Every administrative mutation in `AuditLog` with actor, API key, IP and metadata. |
| Backups | AES-256-CBC (PBKDF2, 200k iterations) with a passphrase kept off-server; SHA-256 manifests. |
| Dependencies | `pnpm audit --prod --audit-level high` in CI. At delivery: 0 known vulnerabilities (nodemailer and multer upgraded; Prisma CLI transitive deps overridden). |

JiMail does **not** claim end-to-end encryption. Mail is protected in transit with TLS and at rest by the server's disk security.

## Security checklist (tested)

Automated tests that cover each item are in `apps/api/test` and `apps/web/e2e`.

| # | Check | Result | Test |
|---|---|---|---|
| 1 | Passwords hashed, never returned or logged | ✅ | lifecycle: list responses contain no secrets; logger redaction |
| 2 | Login errors identical for unknown user / wrong password | ✅ | lifecycle "rejects wrong passwords" |
| 3 | Unverified email cannot sign in | ✅ | lifecycle 1-2 |
| 4 | Verification/reset tokens single-use | ✅ | lifecycle 1-2 (reuse → 400) |
| 5 | CSRF enforced on mutations | ✅ | lifecycle "enforces CSRF" |
| 6 | 2FA required after enrolment; recovery codes single-use | ✅ | lifecycle "two-factor" |
| 7 | Password reset of a mailbox revokes its sessions | ✅ | lifecycle 15 |
| 8 | Suspended mailbox cannot authenticate (Stalwart) | ✅ | lifecycle 16-17 |
| 9 | Cross-tenant read/write/ID reuse blocked (404) | ✅ | lifecycle 19 |
| 10 | Domain already claimed by another tenant refused | ✅ | lifecycle 19 |
| 11 | Mailbox users cannot use admin routes | ✅ | lifecycle 19 |
| 12 | API keys: scope, tenant binding, no personal/admin routes, rotation revokes old | ✅ | lifecycle "API keys" |
| 13 | Role limits (mailbox admin cannot delete/invite owners/billing; last owner protected) | ✅ | lifecycle 20 |
| 14 | Email HTML: scripts, handlers, forms, iframes, `javascript:`, CSS url() removed; remote images blocked | ✅ | unit security.spec + lifecycle 9-12 |
| 15 | Phishing link detection | ✅ | unit |
| 16 | Attachment download headers (attachment + nosniff) | ✅ | lifecycle 9-12 |
| 17 | Webhook signatures verified, idempotent | ✅ | lifecycle "delivery webhooks" |
| 18 | Encryption authenticated (tamper → error) | ✅ | unit |
| 19 | TOTP matches RFC 4226 vectors | ✅ | unit |
| 20 | Destructive actions need typed confirmation (mailbox, domain, organisation) | ✅ | lifecycle "deletes … with safeguards" + UI |
| 21 | No known vulnerable dependencies | ✅ | `pnpm audit --prod` |
| 22 | Backup encrypted, verified and restorable | ✅ | manual drill, see BACKUP.md |
| 23 | Open relay | ⚠️ manual | Stalwart rejects unauthenticated relaying by default; verify on your server with an external relay test after go-live |
| 24 | TLS configuration of public endpoints | ⚠️ manual | needs public DNS; run SSL Labs / `openssl s_client` after go-live |

## Reporting

Report vulnerabilities privately to the platform owner. Do not open public issues for security problems.
