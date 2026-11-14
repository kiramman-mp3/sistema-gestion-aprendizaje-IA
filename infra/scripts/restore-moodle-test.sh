#!/usr/bin/env bash
# Prueba de restauración de la copia de Moodle (Sprint 13): comprueba que la última copia de backup-moodle.sh se
# puede restaurar y que contiene lo mismo que el Moodle real. Una copia que nunca se restauró no es una copia.
#
#   infra/scripts/restore-moodle-test.sh
#
# Verifica las sumas SHA-256, restaura la base en una base temporal del mismo servidor, compara el número de filas
# de cada tabla de Moodle con el de la base real y borra la base temporal. Después descifra moodledata, comprueba que
# el tar está íntegro y que trae los mismos archivos de filedir que el Moodle real. Termina con 0 si todo coincide.
# Las diferencias esperables son las filas escritas entre la copia y la prueba: ejecútalo justo después de
# backup-moodle.sh o acepta una tolerancia con ROW_TOLERANCE y FILE_TOLERANCE (por defecto 0).
#
# Variables: las de backup-moodle.sh, más MOODLE_DB_PREFIX (prefijo de las tablas, por defecto m_ como el Moodle
# local; en una instalación estándar es mdl_), ROW_TOLERANCE y FILE_TOLERANCE.
set -euo pipefail

: "${BACKUP_PASSPHRASE_FILE:?Define BACKUP_PASSPHRASE_FILE (archivo con la contraseña de cifrado)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/smart-lms}"
MOODLE_COMPOSE_CMD="${MOODLE_COMPOSE_CMD:-docker compose -p smart-lms-moodle}"
MOODLE_DB_SERVICE="${MOODLE_DB_SERVICE:-db}"
MOODLE_DB_USER="${MOODLE_DB_USER:-moodle}"
MOODLE_DB_NAME="${MOODLE_DB_NAME:-moodle}"
MOODLE_WEB_SERVICE="${MOODLE_WEB_SERVICE:-webserver}"
MOODLE_DATAROOT="${MOODLE_DATAROOT:-/var/www/moodledata}"
MOODLE_DB_PREFIX="${MOODLE_DB_PREFIX:-m_}"
ROW_TOLERANCE="${ROW_TOLERANCE:-0}"
FILE_TOLERANCE="${FILE_TOLERANCE:-0}"

export MSYS_NO_PATHCONV=1

[[ "${MOODLE_DB_PREFIX}" =~ ^[a-z_][a-z0-9_]*$ ]] || {
  echo "MOODLE_DB_PREFIX no válido: ${MOODLE_DB_PREFIX}" >&2
  exit 2
}
[[ -f "${BACKUP_DIR}/LATEST-moodle" ]] || {
  echo "[restore-moodle-test] No hay copias de Moodle en ${BACKUP_DIR}." >&2
  exit 1
}
TS="$(cat "${BACKUP_DIR}/LATEST-moodle")"
SCRATCH="restore_test_moodle_$(date -u +%Y%m%d%H%M%S)"

mexec() {
  ${MOODLE_COMPOSE_CMD} exec -T "$@"
}

decrypt() {
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:${BACKUP_PASSPHRASE_FILE}" -in "$1"
}

echo "[restore-moodle-test] copia ${TS}: verificando sumas..."
(cd "${BACKUP_DIR}" && sha256sum -c "SHA256SUMS-moodle-${TS}")

cleanup() {
  mexec "${MOODLE_DB_SERVICE}" dropdb -U "${MOODLE_DB_USER}" --if-exists "${SCRATCH}" > /dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[restore-moodle-test] restaurando la base en ${SCRATCH}..."
mexec "${MOODLE_DB_SERVICE}" createdb -U "${MOODLE_DB_USER}" "${SCRATCH}"
decrypt "${BACKUP_DIR}/moodle-db-${TS}.dump.enc" \
  | mexec "${MOODLE_DB_SERVICE}" pg_restore -U "${MOODLE_DB_USER}" -d "${SCRATCH}" --no-owner --exit-on-error

# Filas por tabla de Moodle, una por línea: nombre|filas. Una sola consulta por base (Moodle tiene cientos de tablas).
counts() {
  mexec "${MOODLE_DB_SERVICE}" psql -U "${MOODLE_DB_USER}" -d "$1" -At -F '|' -c "
    SELECT table_name,
           (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', table_name), false, true, '')))[1]::text
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name LIKE '${MOODLE_DB_PREFIX//_/\\_}%'
    ORDER BY 1" | tr -d '\r'
}

echo "[restore-moodle-test] comparando tablas..."
real="$(counts "${MOODLE_DB_NAME}")"
restored="$(counts "${SCRATCH}")"

# Un Moodle tiene cientos de tablas; con menos de 100 el prefijo está mal o la base no es de Moodle.
tables=$(grep -c '|' <<< "${real}" || true)
if ((tables < 100)); then
  echo "[restore-moodle-test] FALLÓ: solo ${tables} tablas con el prefijo ${MOODLE_DB_PREFIX}; revisa MOODLE_DB_PREFIX." >&2
  exit 1
fi

status=0
differ=0
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
    differ=$((differ + 1))
    status=1
  fi
done <<< "${real}"
for table in user course course_modules grade_grades files; do
  echo "  ${MOODLE_DB_PREFIX}${table}: $(grep -E "^${MOODLE_DB_PREFIX}${table}\|" <<< "${restored}" | cut -d'|' -f2) filas restauradas"
done
echo "  ${tables} tablas comparadas, ${differ} con diferencias"

echo "[restore-moodle-test] comprobando moodledata..."
listing="$(decrypt "${BACKUP_DIR}/moodledata-${TS}.tar.gz.enc" | tar -tzf -)"
backup_files=$(grep -cE '^\./filedir/.+[^/]$' <<< "${listing}" || true)
real_files=$(mexec "${MOODLE_WEB_SERVICE}" find "${MOODLE_DATAROOT}/filedir" -type f | grep -c . || true)
file_diff=$((real_files > backup_files ? real_files - backup_files : backup_files - real_files))
if ((file_diff > FILE_TOLERANCE)); then
  echo "  DIFIERE filedir: real ${real_files} archivos, copia ${backup_files}"
  status=1
else
  echo "  ok      filedir: ${backup_files} archivos (real: ${real_files})"
fi

if ((status == 0)); then
  echo "[restore-moodle-test] OK: la copia ${TS} de Moodle se restaura y coincide con el Moodle real."
else
  echo "[restore-moodle-test] FALLÓ." >&2
fi
exit "${status}"
