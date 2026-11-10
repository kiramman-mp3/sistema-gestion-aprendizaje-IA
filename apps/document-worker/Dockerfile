# Imagen del worker documental. Se construye desde la raíz del monorepo:
#   docker build -f apps/document-worker/Dockerfile .
FROM node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install -g pnpm@12.18.0
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/document-worker/package.json apps/document-worker/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --filter @smart-lms/document-worker...
COPY apps/document-worker apps/document-worker
COPY packages/contracts packages/contracts
RUN pnpm --filter @smart-lms/document-worker... build \
  && pnpm --filter @smart-lms/document-worker deploy --prod --legacy /out

FROM node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS runtime
ENV NODE_ENV=production
# OCR de PDF escaneados (RF-04): pdftoppm rasteriza y Tesseract reconoce texto en español.
RUN apk add --no-cache poppler-utils tesseract-ocr tesseract-ocr-data-spa
WORKDIR /app
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /repo/apps/document-worker/dist ./dist
USER node
CMD ["node", "dist/main.js"]
