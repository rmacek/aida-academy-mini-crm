# syntax=docker/dockerfile:1.7
FROM node:24.6.0-alpine3.22 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:24.6.0-alpine3.22 AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24.6.0-alpine3.22 AS runtime
ARG VERSION=1.0.4
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
RUN addgroup -S -g 10001 aidacrm && adduser -S -u 10001 -G aidacrm aidacrm
COPY --from=build --chown=aidacrm:aidacrm /app/.next/standalone ./
COPY --from=build --chown=aidacrm:aidacrm /app/.next/static ./.next/static
COPY --from=build --chown=aidacrm:aidacrm /app/public ./public
USER 10001:10001
EXPOSE 3000
CMD ["node", "server.js"]
