# syntax=docker/dockerfile:1.7
# JiMail web image. Build from the repository root:
#   docker build -f apps/web/Dockerfile -t jimail-web .
FROM node:22.23-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=secret,id=ca,required=false \
    NODE_EXTRA_CA_CERTS=/run/secrets/ca npm_config_cafile=$( [ -f /run/secrets/ca ] && echo /run/secrets/ca ) npm install -g pnpm@10.28.0

FROM base AS build
WORKDIR /repo
# Let the build use swap on small (1 GB) servers instead of failing at the default heap limit.
ENV NODE_OPTIONS=--max-old-space-size=1536
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN --mount=type=secret,id=ca,required=false \
    NODE_EXTRA_CA_CERTS=/run/secrets/ca npm_config_cafile=$( [ -f /run/secrets/ca ] && echo /run/secrets/ca ) \
    pnpm install --frozen-lockfile --filter @jimail/web...
COPY apps/web apps/web
RUN --mount=type=secret,id=ca,required=false \
    cd apps/web && NODE_EXTRA_CA_CERTS=/run/secrets/ca pnpm exec next build

FROM base AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
