#!/usr/bin/env bash
# Starts a throwaway Stalwart v1 container for development and tests, bootstraps it through its
# JMAP API (no wizard) and prints the admin API key. Usage:
#   eval "$(./scripts/dev-stalwart.sh)"     # exports STALWART_URL and STALWART_API_KEY
set -euo pipefail
NAME=${STALWART_DEV_NAME:-jimail-dev-stalwart}
PORT=${STALWART_DEV_PORT:-18080}
HOSTNAME_=${STALWART_DEV_HOSTNAME:-mail.jimail.test}
DOMAIN=${HOSTNAME_#*.}
PW=$(openssl rand -hex 12)
URL=http://127.0.0.1:$PORT
log() { echo "$*" >&2; }
jmap() { curl -sf -H "Authorization: $1" -H 'Content-Type: application/json' "$URL/jmap/" -d "{\"using\":[\"urn:ietf:params:jmap:core\",\"urn:stalwart:jmap\"],\"methodCalls\":$2}"; }
wait_up() { for _ in $(seq 1 60); do curl -sf "$URL/healthz/live" >/dev/null && return 0; sleep 1; done; log "Stalwart did not start"; exit 1; }

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker volume rm "$NAME-etc" "$NAME-data" >/dev/null 2>&1 || true
log "Starting $NAME on $URL…"
docker run -d --name "$NAME" --init -e STALWART_RECOVERY_ADMIN="admin:$PW" -e STALWART_HOSTNAME="$HOSTNAME_" \
  -p 127.0.0.1:$PORT:8080 -p 127.0.0.1:1025:25 -p 127.0.0.1:1465:465 -p 127.0.0.1:1993:993 \
  -v "$NAME-etc:/etc/stalwart" -v "$NAME-data:/var/lib/stalwart" "${STALWART_IMAGE:-stalwartlabs/stalwart:v1}" >/dev/null
wait_up
BASIC="Basic $(printf 'admin:%s' "$PW" | base64)"
OUT=$(jmap "$BASIC" "[[\"x:Bootstrap/set\",{\"update\":{\"singleton\":{\"defaultHostname\":\"$HOSTNAME_\",\"defaultDomain\":\"$DOMAIN\",\"requestTlsCertificate\":false,\"generateDkimKeys\":true,\"tracer\":{\"@type\":\"Stdout\",\"ansi\":false,\"level\":\"warn\"}}}},\"b\"]]")
USER=$(echo "$OUT" | sed -E 's/.*"username":"([^"]+)".*/\1/'); SECRET=$(echo "$OUT" | sed -E 's/.*"secret":"([^"]+)".*/\1/')
docker restart "$NAME" >/dev/null; sleep 2; wait_up
ADMIN="Basic $(printf '%s:%s' "$USER" "$SECRET" | base64)"
KEY=$(jmap "$ADMIN" '[["x:ApiKey/set",{"create":{"k":{"description":"JiMail dev","permissions":{"@type":"Inherit"},"allowedIps":{}}}},"c"]]' | sed -E 's/.*"secret":"([^"]+)".*/\1/')
log "Stalwart ready (admin $USER)."
echo "export STALWART_URL=$URL"
echo "export STALWART_API_KEY=$KEY"
