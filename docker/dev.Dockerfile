# Debian (glibc) to match typical dev hosts; later phases add native deps (sharp).
FROM node:24-bookworm-slim
RUN corepack enable
ENV npm_config_store_dir=/pnpm-store CI=true
WORKDIR /app
