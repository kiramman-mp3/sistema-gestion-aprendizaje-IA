#!/usr/bin/env bash
# Copia de seguridad cifrada de la base de Moodle y de moodledata (Sprint 13, RNF-08).
#
#   infra/scripts/backup-moodle.sh
#
# Complementa backup.sh (base auxiliar y archivos subidos). En producción el Moodle es de la institución: este script
# sirve si corre con Docker Compose; si no, su equipo aplica el mismo procedimiento con sus herramientas. Por defecto
# apunta al Moodle local de desarrollo (infra/scripts/moodle.sh up).
#
# Genera en BACKUP_DIR, con la misma marca de tiempo:
#   moodle-db-<ts>.dump.enc         pg_dump de la base de Moodle en formato personalizado, cifrado con AES-256
#   moodledata-<ts>.tar.gz.enc      moodledata sin cachés, sesiones ni temporales, cifrado igual
#   SHA256SUMS-moodle-<ts>          sumas de verificación de los dos
# y actualiza LATEST-moodle. Borra las copias de Moodle de más de RETENTION_DAYS días.
#
# Variables:
#   BACKUP_PASSPHRASE_FILE  Archivo con la contraseña de cifrado (obligatorio); la misma de backup.sh sirve.
#   BACKUP_DIR              Destino (por defecto /var/backups/smart-lms)
#   RETENTION_DAYS          Días que se conservan (por defecto 14)
#   MOODLE_COMPOSE_CMD      Comando de compose del Moodle (por defecto: docker compose -p smart-lms-moodle, el
#                           proyecto del Moodle local; no se usa el envoltorio de moodle-docker porque escribe
#                           avisos en la salida estándar y corrompe el volcado)
#   MOODLE_DB_SERVICE       Servicio de PostgreSQL (por defecto db)
#   MOODLE_DB_USER          Usuario de la base (por defecto moodle)
#   MOODLE_DB_NAME          Base de Moodle (por defecto moodle)
#   MOODLE_WEB_SERVICE      Servicio con moodledata y el código de Moodle (por defecto webserver)
#   MOODLE_DATAROOT         Ruta de moodledata en ese servicio (por defecto /var/www/moodledata)
#   MOODLE_DIR              Ruta del código de Moodle en ese servicio (por defecto /var/www/html)
#   MAINTENANCE             1 pone Moodle en modo mantenimiento durante la copia (por defecto 0). La base sale
#                           consistente igual; el modo mantenimiento evita que moodledata cambie a mitad de la copia.
set -euo pipefail

: "${BACKUP_PASSPHRASE_FILE:?Define BACKUP_PASSPHRASE_FILE (archivo con la contraseña de cifrado)}"
[[ -s "${BACKUP_PASSPHRASE_FILE}" ]] || {
  echo "BACKUP_PASSPHRASE_FILE está vacío o no existe." >&2
  exit 1
}

BACKUP_DIR="${BACKUP_DIR:-/var/backups/smart-lms}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
MOODLE_COMPOSE_CMD="${MOODLE_COMPOSE_CMD:-docker compose -p smart-lms-moodle}"
MOODLE_DB_SERVICE="${MOODLE_DB_SERVICE:-db}"
MOODLE_DB_USER="${MOODLE_DB_USER:-moodle}"
MOODLE_DB_NAME="${MOODLE_DB_NAME:-moodle}"
MOODLE_WEB_SERVICE="${MOODLE_WEB_SERVICE:-webserver}"
MOODLE_DATAROOT="${MOODLE_DATAROOT:-/var/www/moodledata}"
MOODLE_DIR="${MOODLE_DIR:-/var/www/html}"
MAINTENANCE="${MAINTENANCE:-0}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"

# En Git Bash (Windows), evita que las rutas del contenedor se conviertan en rutas de Windows.
export MSYS_NO_PATHCONV=1

mexec() {
  ${MOODLE_COMPOSE_CMD} exec -T "$@"
}

encrypt() {
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:${BACKUP_PASSPHRASE_FILE}"
}

maintenance() {
  mexec "${MOODLE_WEB_SERVICE}" php "${MOODLE_DIR}/admin/cli/maintenance.php" "$1" > /dev/null
}

umask 077
mkdir -p "${BACKUP_DIR}"
cleanup() {
  # Si algo falla a medias no se deja una copia incompleta con nombre de copia buena, ni Moodle en mantenimiento.
  rm -f "${BACKUP_DIR}"/*.tmp
  if [[ "${MAINTENANCE}" == "1" ]]; then
    maintenance --disable || echo "[backup-moodle] AVISO: no se pudo quitar el modo mantenimiento." >&2
  fi
}
trap cleanup EXIT

if [[ "${MAINTENANCE}" == "1" ]]; then
  echo "[backup-moodle] modo mantenimiento activado..."
  maintenance --enable
fi

DB_FILE="${BACKUP_DIR}/moodle-db-${TS}.dump.enc"
DATA_FILE="${BACKUP_DIR}/moodledata-${TS}.tar.gz.enc"

echo "[backup-moodle] base de datos..."
# pg_dump dentro del contenedor (socket local, sin contraseña en la línea de comandos).
mexec "${MOODLE_DB_SERVICE}" pg_dump -U "${MOODLE_DB_USER}" -Fc "${MOODLE_DB_NAME}" | encrypt > "${DB_FILE}.tmp"
mv "${DB_FILE}.tmp" "${DB_FILE}"

echo "[backup-moodle] moodledata..."
# Las cachés, sesiones y temporales se regeneran solos; copiarlos solo agranda la copia (documentación de Moodle).
mexec "${MOODLE_WEB_SERVICE}" tar -C "${MOODLE_DATAROOT}" \
  --exclude=./cache --exclude=./localcache --exclude=./sessions --exclude=./temp --exclude=./trashdir \
  -czf - . | encrypt > "${DATA_FILE}.tmp"
mv "${DATA_FILE}.tmp" "${DATA_FILE}"

(cd "${BACKUP_DIR}" && sha256sum "moodle-db-${TS}.dump.enc" "moodledata-${TS}.tar.gz.enc" > "SHA256SUMS-moodle-${TS}")
printf '%s\n' "${TS}" > "${BACKUP_DIR}/LATEST-moodle"

echo "[backup-moodle] borrando copias de Moodle de más de ${RETENTION_DAYS} días..."
find "${BACKUP_DIR}" -maxdepth 1 -type f \
  \( -name 'moodle-db-*.dump.enc' -o -name 'moodledata-*.tar.gz.enc' -o -name 'SHA256SUMS-moodle-*' \) \
  -mtime "+${RETENTION_DAYS}" -print -delete

echo "[backup-moodle] listo en ${BACKUP_DIR}: moodle-db-${TS}.dump.enc ($(du -h "${DB_FILE}" | cut -f1)), moodledata-${TS}.tar.gz.enc ($(du -h "${DATA_FILE}" | cut -f1))"
