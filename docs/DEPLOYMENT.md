# Deployment

## Server sizing

| Scale | vCPU | RAM | Disk | Notes |
|---|---|---|---|---|
| Pilot (≤ 100 mailboxes) | 2 | 4 GB | 40 GB SSD | Minimum |
| Small business host (≤ 1 000 mailboxes) | 4 | 8 GB | 200 GB+ SSD | Plan disk for 2–5 GB per active mailbox |
| Larger | 8+ | 16 GB+ | NVMe, separate volume for PostgreSQL | Consider the scaling notes below |

Requirements: static public IPv4 (IPv6 optional), provider allows **TCP 25 in and out**, reverse DNS control, Linux with Docker Engine 24+ and the Compose plugin.

## Firewall

Open: `80`, `443` (web + ACME), `25` (inbound mail), `465` (submission, TLS), `993` (IMAPS), `995` (POP3S, optional), `4190` (ManageSieve, optional). Keep everything else closed — PostgreSQL, Redis and Stalwart's HTTP listener are not published.

## DNS records for the platform

| Record | Value |
|---|---|
| `APP_DOMAIN` A/AAAA | server IP |
| `MAIL_HOSTNAME` A/AAAA | server IP |
| PTR of the server IP | `MAIL_HOSTNAME` (set at the hosting provider) |

Customer domains need their own records; JiMail shows the exact values per domain ([DOMAINS.md](DOMAINS.md)).

## Installation

```bash
sudo mkdir -p /opt/jimail && sudo chown $USER /opt/jimail
git clone https://github.com/shaa2020/jimail.git /opt/jimail && cd /opt/jimail
./scripts/jimail init          # creates .env with generated secrets (mode 600)
nano .env                      # APP_DOMAIN, MAIL_HOSTNAME, MAIL_PUBLIC_IP, ACME_EMAIL
./scripts/jimail up            # builds images, starts everything, runs DB migrations
./scripts/jimail setup-mail    # headless Stalwart configuration
./scripts/jimail create-admin you@example.com "Your Name"
```

What `setup-mail` does (each step was tested against Stalwart 1.2.1):

1. Starts Stalwart with a temporary `STALWART_RECOVERY_ADMIN` credential (random).
2. Submits the `Bootstrap` object through the API: hostname, default domain, **PostgreSQL data store** (password from `STALWART_DB_PASSWORD`), DKIM key generation, Let's Encrypt.
3. Restarts Stalwart with the permanent configuration and **removes the recovery credential**.
4. Switches ACME to HTTP-01 (Caddy owns port 443), creates the admin API key JiMail uses (written to `.env`) and registers the signed delivery-event webhook.

The Stalwart administrator credentials are saved to `infra/secrets/stalwart-admin.json` (mode 600). JiMail never exposes Stalwart's admin UI: Caddy returns 404 for `/admin` on the mail hostname.

## TLS

- `APP_DOMAIN` and `MAIL_HOSTNAME` (HTTPS) certificates: Caddy, automatic Let's Encrypt.
- Mail ports (465/993/995): Stalwart obtains its own certificate for `MAIL_HOSTNAME` via ACME HTTP-01; Caddy forwards `/.well-known/acme-challenge/` on port 80 to Stalwart.
- Customer `autoconfig.<domain>`, `autodiscover.<domain>`, `mta-sts.<domain>`: Caddy on-demand TLS, permitted only when the API confirms the domain is verified.

Check: `openssl s_client -connect MAIL_HOSTNAME:465 -servername MAIL_HOSTNAME </dev/null | openssl x509 -noout -issuer -dates`.

## System email

Verification, password-reset and invitation emails are sent with `SMTP_*`. After setup, create a domain and a mailbox such as `no-reply@yourdomain` in JiMail and use its credentials (`SMTP_HOST=MAIL_HOSTNAME`, port 465). Until configured, these emails are logged as "not sent" and users cannot self-verify (platform admins can still create organisations and send invitations once SMTP works).

## Go-live checklist

- [ ] `./scripts/jimail status` shows all components healthy.
- [ ] Admin console → **Deliverability**: reverse DNS passes, public IP set.
- [ ] Outbound port 25: `nc -vz gmail-smtp-in.l.google.com 25` from the server succeeds.
- [ ] Send a message from a JiMail mailbox to an external Gmail/Outlook account; "Show original" reports SPF, DKIM and DMARC **pass**. Reply arrives in JiMail.
- [ ] Mail app test: IMAP 993 + SMTP 465 in Thunderbird or Apple Mail.
- [ ] Backups scheduled, copied off-site, and one `verify-backup` run succeeded.
- [ ] Platform admin has 2FA enabled; `ALLOW_SIGNUP` set as intended.
- [ ] `ALERT_WEBHOOK_URL` configured and tested.

## Updating

```bash
./scripts/jimail update     # git pull → backup → build → up (migrations run automatically)
```

Stalwart follows the `v1` image tag (minor releases). Pin `STALWART_VERSION` to an exact version to control upgrades, and read Stalwart's upgrade notes before changing major versions.

## Scaling

The single-node stack serves hundreds of organisations. Beyond that:

1. Move PostgreSQL to a managed or dedicated server (point `DATABASE_URL` and Stalwart's data store at it).
2. Run several `api` replicas behind Caddy (stateless; sessions and rate limits live in PostgreSQL/Redis). Run one `worker` (jobs are queue-based; more workers are safe).
3. Put Stalwart's blob store on S3-compatible storage and run Stalwart as a cluster (shared PostgreSQL + Redis/Keep coordination) per Stalwart's cluster documentation.
4. Use several outbound IPs with good reputation for large sending volumes.
