# syntax=docker/dockerfile:1.7
# JiMail API + worker image. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t jimail-api .
FROM node:22.23-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# The optional "ca" build secret supports building behind a TLS-intercepting proxy (switches apt to HTTPS).
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then \
      sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources; \
      cp /run/secrets/ca /tmp/build-ca.crt && chmod 644 /tmp/build-ca.crt; \
      echo 'Acquire::https::CAInfo "/tmp/build-ca.crt";' > /etc/apt/apt.conf.d/99build-ca; \
      if [ -n "$https_proxy" ]; then echo "Acquire::https::Proxy \"$https_proxy\";" >> /etc/apt/apt.conf.d/99build-ca; fi; \
    fi \
 && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/99build-ca /tmp/build-ca.crt \
 && NODE_EXTRA_CA_CERTS=/run/secrets/ca npm_config_cafile=$( [ -f /run/secrets/ca ] && echo /run/secrets/ca ) npm install -g pnpm@10.28.0

FROM base AS build
WORKDIR /repo
# Let the compiler use swap on small (1 GB) servers instead of failing at the default heap limit.
ENV NODE_OPTIONS=--max-old-space-size=1536
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
# Optional build secret "ca": extra CA bundle for builds behind a TLS-intercepting proxy.
RUN --mount=type=secret,id=ca,required=false \
    NODE_EXTRA_CA_CERTS=/run/secrets/ca npm_config_cafile=$( [ -f /run/secrets/ca ] && echo /run/secrets/ca ) \
    pnpm install --frozen-lockfile --filter @jimail/api...
COPY apps/api apps/api
RUN --mount=type=secret,id=ca,required=false \
    cd apps/api && NODE_EXTRA_CA_CERTS=/run/secrets/ca pnpm exec prisma generate && pnpm exec tsc -p tsconfig.build.json \
 && pnpm --filter @jimail/api deploy --prod --legacy /out \
 && cp -r dist prisma /out/ \
 && cd /out && NODE_EXTRA_CA_CERTS=/run/secrets/ca ./node_modules/.bin/prisma generate

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
