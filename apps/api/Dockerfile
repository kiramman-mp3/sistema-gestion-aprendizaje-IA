# Imagen del backend. Se construye desde la raíz del monorepo:
#   docker build -f apps/api/Dockerfile .
FROM node:26.13.0-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install -g pnpm@12.18.0
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --filter @smart-lms/api...
COPY apps/api apps/api
COPY packages/contracts packages/contracts
RUN pnpm --filter @smart-lms/api... build \
  && pnpm --filter @smart-lms/api deploy --prod --legacy /out

FROM node:26.13.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
