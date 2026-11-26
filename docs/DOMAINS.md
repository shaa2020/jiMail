# Customer domains

## Onboarding flow

1. An organisation administrator adds `company.com` (plan limits and global uniqueness are enforced).
2. JiMail generates a random token and shows one record: `TXT _jimail.company.com = jimail-verification=<token>`.
3. **Verify ownership** (also retried automatically every 30 minutes for 14 days) looks the record up on public resolvers. Only when it matches is the domain created on the mail server — Stalwart then generates DKIM keys.
4. JiMail reads Stalwart's computed DNS zone for the domain and shows the exact records.
5. Every 30 minutes (and on **Re-check DNS**) JiMail evaluates the records. The domain becomes **Active** only when every required check passes. If a record later disappears, the status drops back and a security event is raised.

JiMail never writes to customer DNS.

## Records checked

| Check | Required | Rule |
|---|---|---|
| Ownership TXT | yes | exact token match |
| MX | yes | points to `MAIL_HOSTNAME`; warning if other MX hosts remain |
| SPF | yes | exactly one `v=spf1` record that authorises the server (`mx`, `a:MAIL_HOSTNAME` or `ip4:` of `MAIL_PUBLIC_IP`); `include:` gives a warning |
| DKIM | yes | every selector Stalwart signs with is published with the matching key |
| DMARC | yes | exactly one `v=DMARC1` record; `p=none` gives a warning |
| MTA-STS, TLS-RPT, autoconfig CNAME | no | recommended |
| Reverse DNS | platform | PTR of `MAIL_PUBLIC_IP` equals `MAIL_HOSTNAME` (Deliverability page) |

A passing DNS configuration improves deliverability but does not guarantee inbox placement; reputation builds with consistent, low-complaint sending.

## Catch-all, aliases, forwarding

- **Catch-all**: per domain, must target a mailbox or alias of the same organisation. Off by default (recommended).
- **Aliases**: extra addresses on any verified domain of the organisation, delivered into one mailbox.
- **Forwarding**: up to 10 addresses per mailbox, optional local copy (Stalwart mail rule).
