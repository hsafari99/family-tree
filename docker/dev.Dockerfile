# Debian (glibc) to match typical dev hosts; later phases add native deps (sharp).
FROM node:24-bookworm-slim
# Install pnpm into the image (same version as package.json "packageManager")
# so containers don't download it on every start.
RUN npm install -g pnpm@12.18.0 && pnpm --version
ENV npm_config_store_dir=/pnpm-store CI=true
WORKDIR /app
