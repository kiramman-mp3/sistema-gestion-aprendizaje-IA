#!/usr/bin/env bash
# Copia de seguridad cifrada de la base auxiliar y de los archivos subidos (Sprint 13, RNF-08).
#
#   infra/scripts/backup.sh
#
# Genera en BACKUP_DIR, con la misma marca de tiempo:
#   db-<ts>.dump.enc       pg_dump en formato personalizado, cifrado con AES-256 (openssl, PBKDF2)
#   files-<ts>.tar.gz.enc  archivos subidos (volumen file_storage), cifrados igual
#   SHA256SUMS-<ts>        sumas de verificación de los dos
# y actualiza LATEST con la marca de tiempo (lo usa infra/monitoring/check-health.sh para avisar si no hay
# copias recientes). Borra las copias de más de RETENTION_DAYS días.
#
# Variables:
#   BACKUP_PASSPHRASE_FILE  Archivo con la contraseña de cifrado (obligatorio). Guárdala también FUERA del
#                           servidor: sin ella las copias no se pueden restaurar.
#   BACKUP_DIR              Destino (por defecto /var/backups/smart-lms)
#   RETENTION_DAYS          Días que se conservan (por defecto 14)
#   COMPOSE_CMD             Comando de compose (por defecto: docker compose --env-file .env.production
#                           -f docker-compose.prod.yml)
#   FILES_VOLUME            Volumen de archivos (por defecto smart-lms_file_storage)
#
# Se programa con cron, por ejemplo cada noche:  15 2 * * * cd /opt/smart-lms && infra/scripts/backup.sh
set -euo pipefail

: "${BACKUP_PASSPHRASE_FILE:?Define BACKUP_PASSPHRASE_FILE (archivo con la contraseña de cifrado)}"
[[ -s "${BACKUP_PASSPHRASE_FILE}" ]] || {
  echo "BACKUP_PASSPHRASE_FILE está vacío o no existe." >&2
  exit 1
}

BACKUP_DIR="${BACKUP_DIR:-/var/backups/smart-lms}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE_CMD="${COMPOSE_CMD:-docker compose --env-file .env.production -f docker-compose.prod.yml}"
FILES_VOLUME="${FILES_VOLUME:-smart-lms_file_storage}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"

encrypt() {
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:${BACKUP_PASSPHRASE_FILE}"
}

umask 077
mkdir -p "${BACKUP_DIR}"
# Si algo falla a medias no se deja una copia incompleta con nombre de copia buena.
trap 'rm -f "${BACKUP_DIR}"/*.tmp' EXIT

DB_FILE="${BACKUP_DIR}/db-${TS}.dump.enc"
FILES_FILE="${BACKUP_DIR}/files-${TS}.tar.gz.enc"

echo "[backup] base de datos..."
# pg_dump dentro del contenedor (socket local, sin contraseña en la línea de comandos).
${COMPOSE_CMD} exec -T app-db pg_dump -U app -Fc ai_assistant | encrypt > "${DB_FILE}.tmp"
mv "${DB_FILE}.tmp" "${DB_FILE}"

echo "[backup] archivos subidos..."
MSYS_NO_PATHCONV=1 docker run --rm -v "${FILES_VOLUME}:/data:ro" alpine:3.22.8 tar -C /data -czf - . \
  | encrypt > "${FILES_FILE}.tmp"
mv "${FILES_FILE}.tmp" "${FILES_FILE}"

(cd "${BACKUP_DIR}" && sha256sum "db-${TS}.dump.enc" "files-${TS}.tar.gz.enc" > "SHA256SUMS-${TS}")
printf '%s\n' "${TS}" > "${BACKUP_DIR}/LATEST"

echo "[backup] borrando copias de más de ${RETENTION_DAYS} días..."
find "${BACKUP_DIR}" -maxdepth 1 -type f \( -name 'db-*.dump.enc' -o -name 'files-*.tar.gz.enc' -o -name 'SHA256SUMS-*' \) \
  -mtime "+${RETENTION_DAYS}" -print -delete

echo "[backup] listo en ${BACKUP_DIR}: db-${TS}.dump.enc ($(du -h "${DB_FILE}" | cut -f1)), files-${TS}.tar.gz.enc ($(du -h "${FILES_FILE}" | cut -f1))"
