#!/usr/bin/env bash
# Revisa el código PHP del plugin y de los scripts CLI con el estándar "moodle".
#   infra/scripts/phpcs.sh            Revisa
#   infra/scripts/phpcs.sh --fix      Corrige lo que se pueda de forma automática (phpcbf)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE="smart-lms/phpcs:moodle-cs-3.7.0"
TARGETS=(moodle/local/ai_assistant infra/moodle/cli)

if command -v cygpath >/dev/null 2>&1; then
  MOUNT="$(cygpath -m "${ROOT_DIR}")"
  export MSYS_NO_PATHCONV=1
else
  MOUNT="${ROOT_DIR}"
fi

docker build --quiet -t "${IMAGE}" "${MOUNT}/infra/docker/phpcs" >/dev/null

if [[ "${1:-}" == "--fix" ]]; then
  docker run --rm -v "${MOUNT}:/app" --entrypoint phpcbf "${IMAGE}" --standard=moodle "${TARGETS[@]}" || true
else
  docker run --rm -v "${MOUNT}:/app" "${IMAGE}" --standard=moodle --extensions=php -p "${TARGETS[@]}"
fi
