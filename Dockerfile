# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:24.19.0-alpine3.23@sha256:244cc2b53f46f9e876304391d17682b0ddae9ac33491f4857e25e35a36ba7995
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --global --ignore-scripts --no-audit --no-fund npm@12.0.2 \
    && npm cache clean --force \
    && npm ci --ignore-scripts

FROM dependencies AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
ARG VERSION=1.0.19
ARG SOURCE_URL=https://github.com/rmacek/aida-academy-mini-crm
LABEL org.opencontainers.image.title="AIDA CRM" \
      org.opencontainers.image.description="Tenant-installable multi-user CRM with contextual AIDA assistants" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="${SOURCE_URL}"
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    CRM_VERSION=${VERSION}
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /root/.npm \
    && addgroup -S -g 10001 aidacrm \
    && adduser -S -u 10001 -G aidacrm aidacrm
COPY --from=build --chown=aidacrm:aidacrm /app/.next/standalone ./
COPY --from=build --chown=aidacrm:aidacrm /app/.next/static ./.next/static
COPY --from=build --chown=aidacrm:aidacrm /app/public ./public
USER 10001:10001
EXPOSE 3000
CMD ["node", "server.js"]
