# API

Base URL: `https://APP_DOMAIN/api/v1`. Interactive OpenAPI reference: `https://APP_DOMAIN/api/docs` (JSON: `/api/v1/openapi.json`).

## Authentication

Create a key in **Organisation → API keys** (owners/administrators). Send it as a bearer token:

```bash
curl -H "Authorization: Bearer jm_live_..." https://APP_DOMAIN/api/v1/orgs/$ORG_ID/mailboxes
```

- A key belongs to exactly one organisation; any other `:orgId` returns 404.
- Keys only reach routes that declare a matching scope; personal, webmail and platform-admin routes are never available to keys.
- Keys can expire, be rotated (old key revoked immediately) and revoked. Limit: 600 requests/minute per key. All key actions are audited with the key ID.

| Scope | Allows |
|---|---|
| `organization:read` | `GET /orgs/:orgId`, `GET /orgs/:orgId/dashboard` |
| `domains:read` | list domains, DNS status and records |
| `domains:write` | add, verify, re-check, catch-all, remove domains |
| `mailboxes:read` | list/get mailboxes and connection settings |
| `mailboxes:write` | create, update, reset password, suspend, reactivate, delete, forwarding |
| `aliases:write` | add/remove aliases |
| `usage:read` | `GET /orgs/:orgId/usage`, sync usage |
| `delivery:read` | `GET /orgs/:orgId/delivery?days=N` |

Creating organisations is a platform-admin operation (`POST /admin/organizations`, session-authenticated); API keys are organisation-scoped by design so a key can never escape its tenant.

## Common calls

```bash
# Add a domain → returns ownershipRecord {type, host, value}
curl -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"name":"company.com"}' $BASE/orgs/$ORG/domains

# Verify ownership (provisions on the mail server when the TXT record is found)
curl -X POST -H "$AUTH" $BASE/orgs/$ORG/domains/$DOMAIN/verify

# Records to publish
curl -H "$AUTH" $BASE/orgs/$ORG/domains/$DOMAIN/records

# Create a mailbox with a generated password (returned once)
curl -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"domainId":"'$DOMAIN'","localPart":"info","displayName":"Info desk","generatePassword":true,"quotaMb":2048}' \
  $BASE/orgs/$ORG/mailboxes

# Suspend / reactivate
curl -X POST -H "$AUTH" -H 'Content-Type: application/json' -d '{"reason":"left company"}' $BASE/orgs/$ORG/mailboxes/$MB/suspend
curl -X POST -H "$AUTH" $BASE/orgs/$ORG/mailboxes/$MB/reactivate

# Alias
curl -X POST -H "$AUTH" -H 'Content-Type: application/json' -d '{"localPart":"sales","domainId":"'$DOMAIN'"}' $BASE/orgs/$ORG/mailboxes/$MB/aliases

# Usage and delivery statistics
curl -H "$AUTH" $BASE/orgs/$ORG/usage
curl -H "$AUTH" "$BASE/orgs/$ORG/delivery?days=7"
```

## Errors

JSON `{ "statusCode": 400, "message": "...", "errors": [{ "path": "...", "message": "..." }] }`. `401` invalid/missing credentials, `403` insufficient role/scope or suspended, `404` not found (including other tenants), `409` conflict (address or domain in use), `429` rate limited (`retryAfter` seconds), `502` mail server rejected the operation, `503` mail server unreachable.
