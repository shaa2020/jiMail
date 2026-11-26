#!/usr/bin/env bash
# One-line JiMail installer for a fresh Ubuntu 22.04/24.04 server (run as root):
#   curl -fsSL https://raw.githubusercontent.com/shaa2020/jiMail/<branch>/scripts/install.sh | bash -s -- <domain> <admin-email> [admin-password]
# Sets up swap, Docker, JiMail (app.<domain>, mail.<domain>), the mail server and the first admin.
set -euo pipefail
DOMAIN=${1:?usage: install.sh <domain> <admin-email> [admin-password]}
ADMIN_EMAIL=${2:?usage: install.sh <domain> <admin-email> [admin-password]}
ADMIN_PASSWORD=${3:-}
BRANCH=${JIMAIL_BRANCH:-ccr-8668e004-mcjki1}
REPO=${JIMAIL_REPO:-https://github.com/shaa2020/jiMail.git}
DIR=/opt/jimail
LOG=/var/log/jimail-install.log
exec > >(tee -a "$LOG") 2>&1
step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

step "Checking the server"
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
FREE_GB=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
SWAP_ON=$(swapon --show | grep -c /swapfile || true)
if [ "$MEM_MB" -lt 900 ]; then
  echo "This server has ${MEM_MB} MB of memory; JiMail needs at least 1 GB (the \$6 s-1vcpu-1gb Droplet)."
  echo "Resize the Droplet (Resize -> CPU and RAM + disk) or create a new one, then run this command again."; exit 1
fi
if [ "$FREE_GB" -lt $(( SWAP_ON ? 6 : 9 )) ]; then
  echo "Only ${FREE_GB} GB of disk is free; JiMail needs about 6 GB plus 3 GB for swap. Use a 25 GB disk."; exit 1
fi

step "Swap (helps small servers build the app)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 3G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

step "Packages and Docker"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y -q && apt-get install -y -q git openssl curl ca-certificates >/dev/null
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

step "Downloading JiMail"
if [ -d "$DIR/.git" ]; then git -C "$DIR" fetch origin "$BRANCH" && git -C "$DIR" checkout -B "$BRANCH" FETCH_HEAD; else git clone -b "$BRANCH" "$REPO" "$DIR"; fi
cd "$DIR"

step "Configuration"
./scripts/jimail init >/dev/null
IP=$(curl -fs --max-time 3 http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address || curl -fs --max-time 5 https://api.ipify.org || true)
setenv() { if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
setenv APP_DOMAIN "app.$DOMAIN"
setenv MAIL_HOSTNAME "mail.$DOMAIN"
setenv MAIL_PUBLIC_IP "$IP"
setenv ACME_EMAIL "$ADMIN_EMAIL"
setenv ALLOW_SIGNUP false
setenv APP_NAME JiMail

step "Building the application (10-20 minutes on a small server)"
docker compose --env-file .env build api
docker compose --env-file .env build web

step "Starting services"
docker compose --env-file .env up -d
for _ in $(seq 1 60); do docker compose --env-file .env exec -T api node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null && break; sleep 5; done

step "Configuring the mail server"
./scripts/jimail setup-mail

step "Creating the administrator"
[ -n "$ADMIN_PASSWORD" ] || ADMIN_PASSWORD="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 16)Aa1!"
docker compose --env-file .env exec -T -e JIMAIL_ADMIN_PASSWORD="$ADMIN_PASSWORD" api node dist/cli/index.js create-admin "$ADMIN_EMAIL" Admin

step "Daily encrypted backup at 03:17"
( crontab -l 2>/dev/null | grep -v 'jimail backup'; echo "17 3 * * * cd $DIR && ./scripts/jimail backup >> /var/log/jimail-backup.log 2>&1" ) | crontab -

cat <<EOF

=====================================================================
 JiMail is installed.
   Web app:   https://app.$DOMAIN
   Sign in:   $ADMIN_EMAIL
   Password:  $( [ -n "${3:-}" ] && echo "(the one you provided)" || echo "$ADMIN_PASSWORD" )
 Change the password and enable 2FA after signing in.
 Log of this installation: $LOG
=====================================================================
EOF
