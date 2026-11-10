#!/usr/bin/env bash
# Mide el recall del texto extraído de los sílabos sintéticos dentro de la imagen del worker documental, que trae
# Poppler y Tesseract: así también se prueba el OCR de los PDF escaneados.
#   bash infra/scripts/evaluate-text-extraction-docker.sh [--check]
# Requisito: `docker compose --profile worker build document-worker`.
set -euo pipefail
cd "$(dirname "$0")/../.."
export MSYS_NO_PATHCONV=1
IMAGE="${WORKER_IMAGE:-sistema-gestion-aprendizaje-ia-document-worker}"
docker run --rm \
  -v "$PWD/tests/fixtures/synthetic-syllabi:/fixtures:ro" \
  -v "$PWD/infra/scripts/evaluate-text-extraction.mjs:/app/evaluate.mjs:ro" \
  -e WORKER_DIST=/app/dist \
  -e CONTRACTS_ENTRY=/app/node_modules/@smart-lms/contracts/dist/index.js \
  --entrypoint node "$IMAGE" /app/evaluate.mjs /fixtures "$@"
