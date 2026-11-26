# Operations

## Monitoring

- **Admin console → Overview / Monitoring**: health of API, PostgreSQL, Redis, Stalwart and the worker (heartbeat), host CPU/memory/disk, background job counts and failures. Data refreshes every 15–30 s.
- **Mail delivery**: delivered/failed/deferred/received/spam counts and the live outbound queue from Stalwart.
- **Security**: lockouts, suspicious sending, IP bans, DNS regressions, billing suspensions, component failures; resolve items when handled.
- **Health endpoints**: `GET /api/v1/health` (liveness), `GET /api/v1/health/ready` (503 when PostgreSQL or Redis is down). All containers have Docker health checks.

## Alerting

Set `ALERT_WEBHOOK_URL` (Slack-compatible `{"text": ...}`). The worker checks every 5 minutes and posts when a component is down, disk usage exceeds 90 %, or a background job fails all its retries. Alerts are also recorded as critical security events.

## Logs

Structured JSON (pino) to stdout: `./scripts/jimail logs api`. Passwords, tokens, cookies, keys and encrypted fields are redacted; email bodies are never logged. Each request carries an `x-request-id`. Ship logs with your Docker logging driver if you need retention.

## Background jobs (worker)

| Job | Schedule | Purpose |
|---|---|---|
| dns-recheck | 30 min | Ownership retries for pending domains; mail-record checks for verified domains |
| usage-sync | 15 min | Mailbox storage usage from Stalwart |
| billing-lifecycle | hourly | Trial expiry → grace period → suspension |
| usage-snapshot | daily 02:17 | Usage history |
| cleanup | daily 03:43 | Expired sessions/tokens, old login and delivery events, expired invitations |
| health-check | 5 min | Alerts |
| webhook-ensure | 6 h | Keeps the Stalwart delivery webhook registered |

## Abuse handling

When a mailbox exceeds its hourly send limit or produces many failed deliveries, JiMail blocks its outgoing mail in Stalwart, marks it suspended with the reason, and notifies the organisation's administrators and the platform. Investigate (password reset, 2FA), then **Reactivate** the mailbox. Platform admins can suspend any mailbox, domain or organisation.

## Troubleshooting

| Symptom | Check |
|---|---|
| "Mail server integration is not configured" | `STALWART_API_KEY` empty → run `./scripts/jimail setup-mail` |
| Domain stuck "Awaiting verification" | `dig +short TXT _jimail.<domain> @1.1.1.1`; the value must match exactly |
| Messages stay in the queue | Outbound port 25 blocked by provider; see Mail delivery → queue errors |
| Mail lands in spam | Deliverability page; PTR, SPF/DKIM/DMARC pass in headers; warm up the IP |
| Verification emails not arriving | `SMTP_*` not configured; API log shows "System mail not sent" |
| Webmail "Mailbox is not ready" | Mailbox was created while Stalwart was unreachable; delete and recreate |
| Worker unhealthy | `./scripts/jimail logs worker`; Redis password/URL |
