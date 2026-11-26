# Testing

## Strategy

| Layer | Location | Runs against |
|---|---|---|
| Unit | `apps/api/test/unit` | Pure logic: sanitiser, TOTP (RFC vectors), crypto, validation, zone parser, event mapping |
| Integration / API | `apps/api/test/integration/lifecycle.spec.ts` | In-process API over HTTP (supertest) + **real PostgreSQL, Redis and Stalwart 1.2.1** + authoritative test DNS server |
| End-to-end (browser) | `apps/web/e2e` | Real browser (Playwright/Chromium) against the running web app, API and Stalwart |
| Deployment | manual drill | Production Docker images and Compose stack, `setup-mail`, backup/verify/restore |

DNS: public DNS cannot be controlled in tests, so `apps/api/test/support/fake-dns.js` serves the domain's records (TXT/MX/CNAME/PTR) over real UDP DNS; JiMail's checker queries it through Node's resolver exactly as it queries 1.1.1.1 in production.

System email in tests uses `MAIL_TRANSPORT=file` (refused in production) so tests can follow verification and invitation links.

## Running

```bash
eval "$(./scripts/dev-stalwart.sh)"                # Stalwart for tests
pnpm --filter @jimail/api test:unit
pnpm --filter @jimail/api test:integration          # needs apps/api/.env (see .env.example)
# e2e: start fake DNS, API and web, then
FAKE_DNS_FILE=/tmp/fakedns.json pnpm test:e2e       # PW_CHROMIUM_PATH=... to use a preinstalled Chromium
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, builds and `pnpm audit`, then integration and e2e tests with a bootstrapped Stalwart container.

## Testing report (final run)

| Suite | Result |
|---|---|
| API unit tests | **18 / 18 passed** |
| API integration tests (live Stalwart) | **21 / 21 passed** |
| Browser end-to-end (desktop journey + mobile) | **2 / 2 passed** |
| ESLint (API, web) | 0 errors (web: 16 advisory `set-state-in-effect` warnings, see eslint config) |
| TypeScript (API, web) | 0 errors |
| Production builds (API, web, Docker images) | passed |
| `pnpm audit --prod` | 0 known vulnerabilities |
| Compose stack + `setup-mail` | passed; all services healthy; Stalwart on PostgreSQL |
| Backup → verify → restore drill | passed |

### Required lifecycle coverage

| # | Scenario | Covered by | Result |
|---|---|---|---|
| 1 | Register a customer | integration 1-2, e2e | ✅ |
| 2 | Verify the account | integration 1-2, e2e | ✅ |
| 3 | Create an organisation | signup creates it (integration 3, e2e); admin creation (deployment smoke) | ✅ |
| 4 | Add a domain | integration 4-5, e2e | ✅ |
| 5 | Verify the domain | integration 4-5 (fails before TXT, passes after), e2e | ✅ |
| 6 | Configure DNS | integration 6 (records from Stalwart zone, MX/SPF/DKIM/DMARC pass, duplicate SPF detected), e2e | ✅ |
| 7 | Create a mailbox | integration 7, e2e | ✅ |
| 8 | Authenticate the mailbox | integration 8 (mailbox password verified by Stalwart), e2e | ✅ |
| 9 | Send a message | integration 9-12 (JMAP submission through Stalwart), e2e | ✅ |
| 10 | Receive a message | integration 9-12, e2e | ✅ |
| 11 | Reply | integration 9-12 (threaded), e2e | ✅ |
| 12 | Upload/download an attachment | integration 9-12 (byte-identical download) | ✅ |
| 13 | Create an alias | integration 13 (mail to alias delivered) | ✅ |
| 14 | Forwarding | integration 14 (forwarded copy delivered, local copy kept) | ✅ |
| 15 | Change a mailbox password | integration 15 (old password rejected, sessions revoked) | ✅ |
| 16 | Suspend a mailbox | integration 16-17 (Stalwart refuses authentication) | ✅ |
| 17 | Reactivate a mailbox | integration 16-17 | ✅ |
| 18 | Storage usage | integration 18 (usage synced from Stalwart > 0) | ✅ |
| 19 | Tenant isolation | integration 19 + API-key test | ✅ |
| 20 | Organisation administration | integration 20 (invitation, roles, audit), e2e audit log | ✅ |

### Not tested in the build environment

- Delivery to and from **external** providers (needs a public IP, open port 25, public DNS and PTR). Mail flow was tested between mailboxes on a real Stalwart server; external delivery uses the same Stalwart outbound path. Follow the go-live checklist in [DEPLOYMENT.md](DEPLOYMENT.md#go-live-checklist).
- Let's Encrypt issuance (needs public DNS).
- Stripe live API calls (implementation verified for signature checking and event handling logic only by code review; enable test mode keys and run a checkout before selling).
- Third-party desktop/mobile mail apps (standard IMAP 993 / SMTP 465 endpoints provided by Stalwart).
