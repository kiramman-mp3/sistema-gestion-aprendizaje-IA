#!/usr/bin/env bash
# Entorno Moodle de desarrollo basado en moodle-docker (ADR-011).
#
#   infra/scripts/moodle.sh setup         Descarga moodle-docker y Moodle en las versiones fijadas
#   infra/scripts/moodle.sh sync          Clona Moodle en el volumen de Docker (lo hace setup)
#   infra/scripts/moodle.sh up            Levanta Moodle en http://localhost:8000
#   infra/scripts/moodle.sh install       Instala Moodle, configura el plugin y crea el usuario de integración
#   infra/scripts/moodle.sh configure     Copia al plugin el secreto JWT y la URL del backend del .env
#   infra/scripts/moodle.sh seed          Carga datos sintéticos (cursos, usuarios, tareas)
#   infra/scripts/moodle.sh down          Detiene y elimina los contenedores
#   infra/scripts/moodle.sh compose ...   Ejecuta cualquier comando de moodle-docker-compose
#
# Variables (en .env de la raíz o en el entorno):
#   MOODLE_ADMIN_PASSWORD   Contraseña del administrador local (obligatoria para install)
#   PLUGIN_JWT_SECRET       Secreto compartido con el backend (obligatorio para configure)
#   PORT                    Puerto del backend en el host; define la URL que usa el navegador
set -euo pipefail

MOODLE_TAG="v5.1.8"
MOODLE_DOCKER_COMMIT="f0583ec8b00ebdefef51c99f15cd37e19299a998"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CACHE_DIR="${ROOT_DIR}/infra/.cache"
MOODLE_DOCKER_DIR="${CACHE_DIR}/moodle-docker"
MOODLE_DIR="${CACHE_DIR}/moodle"

# Docker Desktop en Windows necesita rutas tipo C:/...; en Linux y macOS se usa la ruta normal.
native_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi
}

load_env() {
  if [[ -f "${ROOT_DIR}/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "${ROOT_DIR}/.env"
    set +a
  fi
  export MOODLE_DOCKER_WWWROOT
  MOODLE_DOCKER_WWWROOT="$(native_path "${MOODLE_DIR}")"
  export MOODLE_DOCKER_DB=pgsql
  export MOODLE_DOCKER_PHP_VERSION="${MOODLE_DOCKER_PHP_VERSION:-8.3}"
  export MOODLE_DOCKER_WEB_PORT="${MOODLE_DOCKER_WEB_PORT:-127.0.0.1:8000}"
  export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-smart-lms-moodle}"
  export SMART_LMS_INFRA_DIR SMART_LMS_PLUGIN_DIR
  SMART_LMS_INFRA_DIR="$(native_path "${ROOT_DIR}/infra")"
  SMART_LMS_PLUGIN_DIR="$(native_path "${ROOT_DIR}/moodle/local/ai_assistant")"
}

mdc() {
  "${MOODLE_DOCKER_DIR}/bin/moodle-docker-compose" "$@"
}

php_cli() {
  # En Git Bash (Windows), evita que /var/www/... se convierta en una ruta de Windows.
  MSYS_NO_PATHCONV=1 mdc exec -T webserver php "$@"
}

cmd_setup() {
  mkdir -p "${CACHE_DIR}"
  if [[ ! -d "${MOODLE_DOCKER_DIR}/.git" ]]; then
    git clone --quiet https://github.com/moodlehq/moodle-docker.git "${MOODLE_DOCKER_DIR}"
  fi
  git -C "${MOODLE_DOCKER_DIR}" fetch --quiet origin
  git -C "${MOODLE_DOCKER_DIR}" -c advice.detachedHead=false checkout --quiet "${MOODLE_DOCKER_COMMIT}"

  # moodle-docker exige MOODLE_DOCKER_WWWROOT; el código real vive en el volumen moodle_code.
  mkdir -p "${MOODLE_DIR}"
  cp "${ROOT_DIR}/infra/moodle/local.yml" "${MOODLE_DOCKER_DIR}/local.yml"
  cmd_sync
  echo "moodle-docker ${MOODLE_DOCKER_COMMIT:0:7} y Moodle ${MOODLE_TAG} listos."
}

# Clona Moodle directamente dentro del volumen moodle_code (ver local.yml). Clonar dentro de Docker
# evita leer miles de archivos desde el sistema de archivos del host. Se repite tras cambiar MOODLE_TAG.
cmd_sync() {
  local volume="${COMPOSE_PROJECT_NAME}_moodle_code"
  docker volume create "${volume}" >/dev/null
  MSYS_NO_PATHCONV=1 docker run --rm \
    -v "${volume}:/dst" \
    -v "$(native_path "${MOODLE_DOCKER_DIR}"):/moodle-docker:ro" \
    alpine:3.22.8 \
    sh -c "apk add --no-cache --quiet git \
      && find /dst -mindepth 1 -delete \
      && git clone --quiet --depth 1 --branch ${MOODLE_TAG} https://github.com/moodle/moodle.git /dst \
      && rm -rf /dst/.git \
      && cp /moodle-docker/config.docker-template.php /dst/config.php"
  echo "Moodle ${MOODLE_TAG} clonado en el volumen ${volume}."
}

cmd_up() {
  mdc up -d
  "${MOODLE_DOCKER_DIR}/bin/moodle-docker-wait-for-db"
  echo "Moodle en http://localhost:${MOODLE_DOCKER_WEB_PORT##*:}"
}

cmd_install() {
  : "${MOODLE_ADMIN_PASSWORD:?Define MOODLE_ADMIN_PASSWORD en .env}"
  php_cli /var/www/html/admin/cli/install_database.php \
    --agree-license \
    --fullname="LMS Inteligente (desarrollo)" \
    --shortname="lms-dev" \
    --summary="Instancia local con datos sintéticos" \
    --adminuser=admin \
    --adminpass="${MOODLE_ADMIN_PASSWORD}" \
    --adminemail=admin@example.com
  php_cli /var/www/html/admin/cli/upgrade.php --non-interactive
  cmd_configure
  php_cli /opt/smart-lms/cli/setup_integration.php
}

# El secreto viaja como variable de entorno del proceso, no como argumento visible en `ps`.
cmd_configure() {
  : "${PLUGIN_JWT_SECRET:?Define PLUGIN_JWT_SECRET en .env (al menos 32 caracteres)}"
  local backendurl="http://localhost:${PORT:-3000}/api/v1"
  MSYS_NO_PATHCONV=1 mdc exec -T -e "SMART_LMS_JWT_SECRET=${PLUGIN_JWT_SECRET}" webserver \
    php -r 'define("CLI_SCRIPT", true); require "/var/www/html/config.php";
      set_config("jwtsecret", getenv("SMART_LMS_JWT_SECRET"), "local_ai_assistant");'
  php_cli /var/www/html/admin/cli/cfg.php --component=local_ai_assistant --name=backendurl --set="${backendurl}"
  echo "Plugin configurado: backend en ${backendurl}."
}

cmd_seed() {
  php_cli /opt/smart-lms/cli/seed.php "$@"
}

main() {
  local command="${1:-}"
  shift || true
  load_env
  case "${command}" in
    setup) cmd_setup ;;
    sync) cmd_sync ;;
    up) cmd_up ;;
    install) cmd_install ;;
    configure) cmd_configure ;;
    seed) cmd_seed "$@" ;;
    down) mdc down ;;
    compose) mdc "$@" ;;
    *)
      sed -n '2,12p' "${BASH_SOURCE[0]}"
      exit 1
      ;;
  esac
}

main "$@"
