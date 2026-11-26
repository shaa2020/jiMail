# Known limitations and remaining setup

## Limitations

1. **External mail delivery not verified from the build environment** — see [TESTING.md](TESTING.md#not-tested-in-the-build-environment). Run the go-live checklist on your server.
2. **No web calendar UI.** Stalwart provides calendars over CalDAV and JMAP for Calendars; JiMail shows CalDAV/CardDAV connection details. A web calendar can be added as a module using JMAP Calendars.
3. **Mailbox restore after deletion** is not available (Stalwart's deleted-account archive is an Enterprise feature). Deletion is protected by typed confirmation and audited; restore whole servers from backups.
4. **Stripe** flows (checkout, portal, webhooks) are implemented but not exercised against Stripe's API. Without a provider, plans are managed manually by platform admins (`Admin → Organisations → Subscription`), and JiMail never fabricates invoices or payments.
5. **Per-account sending limits** are enforced in JiMail webmail and by webhook-driven abuse detection (which blocks sending in Stalwart). Messages sent via SMTP from mail apps are counted through Stalwart events and trigger the same block, but are not throttled per message at the SMTP layer; add a Stalwart `MtaInboundThrottle` rule keyed on the authenticated account for hard SMTP limits.
6. **System metrics** (CPU/memory/disk) are measured on the API container's host view; Stalwart's internal Prometheus metrics are not wired in.
7. **App passwords**: mail apps use the mailbox password. Stalwart supports app passwords (`x:AppPassword`); a self-service UI is not included yet.
8. **Shared/delegated mailboxes**: administrators can grant webmail access to other members; IMAP-level sharing (ACLs) is not managed by JiMail.
9. **Internationalisation**: the interface is English only.
10. **Search** uses Stalwart's full-text index through JMAP; very large mailboxes depend on Stalwart's search performance.

## External setup still required

| Item | Notes |
|---|---|
| Server with static IP and port 25 | Many clouds block 25 by default — request unblocking |
| PTR record | Hosting provider panel |
| DNS for `APP_DOMAIN`, `MAIL_HOSTNAME` | Your DNS provider |
| SMTP credentials for system mail | Use a JiMail mailbox after setup |
| Stripe account (optional) | Set `BILLING_PROVIDER=stripe`, keys, webhook endpoint, and `stripePriceId` on each plan |
| Off-site backup target | rclone/restic destination of your choice |
| Alert webhook (optional) | Slack/Teams/Mattermost incoming webhook |
