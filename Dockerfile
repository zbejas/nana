ARG BUN_VERSION=1.3.12
ARG PB_VERSION=0.36.9
ARG TARGETARCH=amd64

FROM oven/bun:${BUN_VERSION}-slim AS app-base

ARG PB_VERSION
ARG TARGETARCH

WORKDIR /app

LABEL maintainer="Zbejas <info@zbejas.io>"
LABEL description="A self-hosted markdown document management system with version control, designed for simplicity and privacy."
LABEL org.opencontainers.image.source="https://github.com/zbejas/nana"
LABEL org.opencontainers.image.documentation="https://github.com/zbejas/nana/blob/master/README.md"
LABEL org.opencontainers.image.authors="Zbejas"
LABEL org.opencontainers.image.licenses="AGPL-3.0"
LABEL org.opencontainers.image.title="Nana"

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates wget unzip && \
    wget "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" -O /tmp/pb.zip && \
    mkdir -p /tmp/pb && \
    unzip /tmp/pb.zip -d /tmp/pb && \
    mv /tmp/pb/pocketbase /usr/local/bin/pocketbase && \
    chmod +x /usr/local/bin/pocketbase && \
    rm -rf /tmp/pb /tmp/pb.zip && \
    apt-get purge -y wget unzip && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------
# Build stage (creates dist/)
# ---------------------------------------------------------------
FROM app-base AS builder

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production --trust-dependencies
COPY tsconfig.json bunfig.toml build.ts ./
COPY src/ ./src/
RUN bun run build.ts

# -------------------------------------------------------------------
# Development stage — source is bind-mounted & served with hot reload
# -------------------------------------------------------------------
FROM app-base AS development

ENV NODE_ENV=development

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --trust-dependencies

COPY . .

# Ensure pb_data directory exists for PocketBase and Zvec vector store
RUN mkdir -p /app/pocketbase/pb_data/zvec

RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000 8090
ENTRYPOINT ["/app/docker-entrypoint.sh"]

# -------------------------------------------------------------------
# Production runtime stage — minimal files only
# -------------------------------------------------------------------
FROM app-base AS production

ENV NODE_ENV=production

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production --trust-dependencies

COPY --from=builder /app/dist ./dist
COPY src ./src

COPY pocketbase/pb_migrations ./pocketbase/pb_migrations
COPY pocketbase/pb_hooks ./pocketbase/pb_hooks
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN mkdir -p /app/pocketbase/pb_data/zvec
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000 8090
ENTRYPOINT ["/app/docker-entrypoint.sh"]
