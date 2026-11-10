#!/usr/bin/env bash
# Prueba de restauración (Sprint 13): comprueba que la última copia de seguridad se puede restaurar y que
# contiene lo mismo que la base real. Una copia que nunca se restauró no es una copia.
#
#   infra/scripts/restore-test.sh
#
# Verifica las sumas SHA-256, restaura la copia en una base temporal, compara el número de filas de cada
# tabla con el de la base real y borra la base temporal. Termina con 0 si coincide y con 1 si no.
# Las diferencias esperables son las filas escritas entre la copia y la prueba: ejecútalo justo después de
# backup.sh o acepta una tolerancia con ROW_TOLERANCE (por defecto 0 filas de diferencia).
#
# Variables: las de backup.sh, más ROW_TOLERANCE.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/smart-lms}"
COMPOSE_CMD="${COMPOSE_CMD:-docker compose --env-file .env.production -f docker-compose.prod.yml}"
ROW_TOLERANCE="${ROW_TOLERANCE:-0}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ -f "${BACKUP_DIR}/LATEST" ]] || {
  echo "[restore-test] No hay copias en ${BACKUP_DIR}." >&2
  exit 1
}
TS="$(cat "${BACKUP_DIR}/LATEST")"
SCRATCH="restore_test_$(date -u +%Y%m%d%H%M%S)"

echo "[restore-test] copia ${TS}: verificando sumas..."
(cd "${BACKUP_DIR}" && sha256sum -c "SHA256SUMS-${TS}")

cleanup() {
  ${COMPOSE_CMD} exec -T app-db dropdb -U app --if-exists "${SCRATCH}" > /dev/null 2>&1 || true
}
trap cleanup EXIT

COMPOSE_CMD="${COMPOSE_CMD}" "${HERE}/restore.sh" db "${BACKUP_DIR}/db-${TS}.dump.enc" "${SCRATCH}"

# Filas por tabla, una por línea: nombre|filas.
counts() {
  local db="$1" tables table
  tables="$(${COMPOSE_CMD} exec -T app-db psql -U app -d "${db}" -Atc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1" | tr -d '\r')"
  while IFS= read -r table; do
    [[ -n "${table}" ]] || continue
    # `< /dev/null`: sin esto psql lee de la entrada del bucle el resto de la lista de tablas y la consume.
    printf '%s|%s\n' "${table}" "$(${COMPOSE_CMD} exec -T app-db psql -U app -d "${db}" -Atc "SELECT count(*) FROM \"${table}\"" < /dev/null | tr -d '\r')"
  done <<< "${tables}"
}

echo "[restore-test] comparando tablas..."
real="$(counts ai_assistant)"
restored="$(counts "${SCRATCH}")"

# Una comparación casi sin tablas no demuestra nada.
if (($(grep -c '|' <<< "${real}") < 2)); then
  echo "[restore-test] FALLÓ: la base real tiene menos de 2 tablas; algo no va bien." >&2
  exit 1
fi

status=0
while IFS='|' read -r table rows; do
  [[ -n "${table}" ]] || continue
  other="$(grep -E "^${table}\|" <<< "${restored}" | cut -d'|' -f2 || true)"
  if [[ -z "${other}" ]]; then
    echo "  FALTA   ${table} (real: ${rows})"
    status=1
    continue
  fi
  diff=$((rows > other ? rows - other : other - rows))
  if ((diff > ROW_TOLERANCE)); then
    echo "  DIFIERE ${table}: real ${rows}, restaurada ${other}"
    status=1
  else
    echo "  ok      ${table}: ${other}"
  fi
done <<< "${real}"

if ((status == 0)); then
  echo "[restore-test] OK: la copia ${TS} se restaura y coincide con la base real."
else
  echo "[restore-test] FALLÓ." >&2
fi
exit "${status}"
