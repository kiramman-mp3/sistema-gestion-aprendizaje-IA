#!/usr/bin/env bash
# Restaura una copia de seguridad (Sprint 13).
#
#   infra/scripts/restore.sh db    <db-....dump.enc>        [base_destino]
#   infra/scripts/restore.sh files <files-....tar.gz.enc>   [volumen_destino]
#
# Con `db` restaura en la base de destino (por defecto una base nueva, restore_<fecha>, para no pisar la real).
# Para recuperar el servicio tras un desastre, pasa `ai_assistant` como destino con el backend detenido.
# Con `files` extrae en el volumen indicado (por defecto el de archivos subidos).
#
# Variables: BACKUP_PASSPHRASE_FILE (obligatorio), COMPOSE_CMD y FILES_VOLUME, como en backup.sh.
set -euo pipefail

: "${BACKUP_PASSPHRASE_FILE:?Define BACKUP_PASSPHRASE_FILE (archivo con la contraseña de cifrado)}"
COMPOSE_CMD="${COMPOSE_CMD:-docker compose --env-file .env.production -f docker-compose.prod.yml}"
FILES_VOLUME="${FILES_VOLUME:-smart-lms_file_storage}"

kind="${1:-}"
file="${2:-}"
[[ -f "${file}" ]] || {
  echo "Uso: restore.sh db|files <archivo> [destino]" >&2
  exit 2
}

decrypt() {
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:${BACKUP_PASSPHRASE_FILE}" -in "${file}"
}

case "${kind}" in
  db)
    target="${3:-restore_$(date -u +%Y%m%d%H%M%S)}"
    if [[ ! "${target}" =~ ^[a-z_][a-z0-9_]*$ ]]; then
      echo "Nombre de base no válido: ${target}" >&2
      exit 2
    fi
    # Si la base de destino no existe se crea; si es la real, el operador ya detuvo el backend.
    exists="$(${COMPOSE_CMD} exec -T app-db psql -U app -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='${target}'")"
    if [[ "${exists}" != "1" ]]; then
      echo "[restore] creando la base ${target}..."
      ${COMPOSE_CMD} exec -T app-db createdb -U app "${target}"
    fi
    echo "[restore] restaurando en ${target}..."
    decrypt | ${COMPOSE_CMD} exec -T app-db pg_restore -U app -d "${target}" --clean --if-exists --no-owner --exit-on-error
    echo "[restore] base ${target} restaurada."
    ;;
  files)
    volume="${3:-${FILES_VOLUME}}"
    echo "[restore] extrayendo en el volumen ${volume}..."
    decrypt | MSYS_NO_PATHCONV=1 docker run --rm -i -v "${volume}:/data" alpine:3.22.8 tar -C /data -xzf -
    echo "[restore] archivos restaurados."
    ;;
  *)
    echo "Uso: restore.sh db|files <archivo> [destino]" >&2
    exit 2
    ;;
esac
