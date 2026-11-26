# Backup and disaster recovery

## What is backed up

`./scripts/jimail backup` writes one encrypted archive to `backups/jimail-<UTC timestamp>.tar.gz.enc` containing:

| Item | Method | Contains |
|---|---|---|
| `jimail.dump` | `pg_dump -Fc` (online, consistent) | organisations, users, domains, mailboxes metadata, billing, audit log, encrypted per-mailbox keys |
| `stalwart.dump` | `pg_dump -Fc` (online, consistent) | all mailboxes and messages (Default blob store lives in the data store), DKIM private keys, TLS certificates, Stalwart configuration objects |
| `stalwart-config.json` | file copy | Stalwart data-store connection (no password; it is an env-var reference) |
| `env` | file copy | all JiMail secrets, including `APP_ENCRYPTION_KEY` (needed to decrypt TOTP secrets and mailbox keys) |
| `stalwart-admin.json` | file copy | Stalwart administrator credentials |
| `SHA256SUMS` | | integrity manifest |

The archive is encrypted with AES-256-CBC (PBKDF2-SHA256, 200 000 iterations) using `BACKUP_PASSPHRASE`; a `.sha256` file is written next to it. The newest `BACKUP_RETENTION` (default 14) archives are kept locally.

Because Stalwart uses PostgreSQL with its default blob store, both dumps are consistent online snapshots, as recommended by Stalwart's backup guide. The search index is not backed up; Stalwart rebuilds it.

## Schedule and off-site copies

```cron
17 3 * * * cd /opt/jimail && ./scripts/jimail backup >> /var/log/jimail-backup.log 2>&1
47 3 * * * rclone copy /opt/jimail/backups remote:jimail-backups --include "*.enc*"
```

Keep `BACKUP_PASSPHRASE` in a password manager **off the server** — without it the backups cannot be decrypted. Avoid 04:00 for backups only if you move Stalwart's blob store to S3 (then follow Stalwart's ordering rules).

## Verify

```bash
./scripts/jimail verify-backup backups/jimail-<timestamp>.tar.gz.enc
```

Checks the file checksum, decrypts, validates the internal manifest and restores both databases into scratch databases (`verify_jimail`, `verify_stalwart`), prints row counts, then drops them. Run it at least monthly.

## Restore

```bash
./scripts/jimail restore backups/jimail-<timestamp>.tar.gz.enc   # asks you to type "restore"
```

Stops the application and mail server, recreates both databases from the dumps, restores Stalwart's `config.json`, and starts everything again.

### Full disaster recovery on a new server

1. Provision the server, install Docker, clone the repository at the same version.
2. Copy the backup archive to `backups/`, and create `.env` containing only `BACKUP_PASSPHRASE=<passphrase>`.
3. Decrypt and take the old `env`: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass pass:$PASS -in <file> | tar -xzf - ./env && mv env .env`.
4. Update `MAIL_PUBLIC_IP` and DNS if the IP changed (and the PTR record).
5. `./scripts/jimail up`, then `./scripts/jimail restore backups/<file>`.
6. `./scripts/jimail status`, then send/receive test mail.

## Tested

A full drill was run on the production Compose stack during development: backup → `verify-backup` (decrypt, checksums, test restore of both databases) → data modified after the backup → `restore` → the modification was gone, both databases restored, all services healthy, and the Stalwart API key authenticated against the restored mail server.
