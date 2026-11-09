FROM node:24-bookworm-slim AS build
RUN npm install -g pnpm@12.18.0 && pnpm --version
ENV CI=true
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @family-tree/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @family-tree/api... build
RUN pnpm --filter @family-tree/api deploy --prod /out

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
