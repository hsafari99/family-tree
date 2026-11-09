# Debian (glibc) to match typical dev hosts; later phases add native deps (sharp).
FROM node:24-bookworm-slim
# Install pnpm into the image (same version as package.json "packageManager")
# so containers don't download it on every start.
RUN npm install -g pnpm@12.18.0 && pnpm --version
ENV pnpm_config_store_dir=/pnpm-store CI=true
# Pre-create the store and node_modules mount points owned by `node` (uid 1000)
# so named volumes inherit that ownership and files written to the bind-mounted
# repo belong to the host user, not root.
RUN mkdir -p /pnpm-store /app/node_modules /app/apps/api/node_modules \
      /app/apps/web/node_modules /app/packages/shared/node_modules \
  && chown -R node:node /pnpm-store /app
USER node
WORKDIR /app
