#!/usr/bin/env bash
# Revisión de salud del despliegue (Sprint 13): sirve para cron, un monitor de disponibilidad o una prueba manual.
#
#   infra/monitoring/check-health.sh
#
# Comprueba:
#   1. El estado del backend (/api/v1/health: base de datos, Redis, Moodle y antivirus).
#   2. Que ningún contenedor del despliegue esté caído o sin pasar su healthcheck.
#   3. Que la última copia de seguridad no sea más antigua de BACKUP_MAX_AGE_HOURS.
#   4. Que el disco de las copias y el de Docker no pasen de DISK_MAX_PERCENT de uso.
#
# Salida (convención de Nagios): una línea de resumen y, debajo, el detalle.
#   0 OK    1 WARNING (por ejemplo, algo degradado o una copia atrasada)    2 CRITICAL (el servicio no responde)
#
# Variables:
#   COMPOSE_CMD             Por defecto: docker compose --env-file .env.production -f docker-compose.prod.yml
#   HEALTH_CMD              Comando que imprime la respuesta de /api/v1/health. Por defecto, wget dentro del
#                           contenedor api (el estado no se publica en internet).
#   BACKUP_DIR              Por defecto /var/backups/smart-lms
#   BACKUP_MAX_AGE_HOURS    Por defecto 26 (una copia diaria con margen)
#   DISK_MAX_PERCENT        Por defecto 85
#
# Ejemplo de cron cada 5 minutos que avisa por correo solo cuando algo falla:
#   */5 * * * * cd /opt/smart-lms && infra/monitoring/check-health.sh > /tmp/smart-lms-health.txt || mail -s "Smart LMS" admin@ejemplo.edu.ec < /tmp/smart-lms-health.txt
set -uo pipefail

COMPOSE_CMD="${COMPOSE_CMD:-docker compose --env-file .env.production -f docker-compose.prod.yml}"
HEALTH_CMD="${HEALTH_CMD:-${COMPOSE_CMD} exec -T api wget -qO- http://127.0.0.1:3000/api/v1/health}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/smart-lms}"
BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"
DISK_MAX_PERCENT="${DISK_MAX_PERCENT:-85}"

level=0
details=()

# Sube el nivel de gravedad sin bajarlo nunca.
raise() {
  local new="$1"
  ((new > level)) && level="${new}"
}

# 1. Backend.
if response="$(${HEALTH_CMD} 2> /dev/null)" && [[ -n "${response}" ]]; then
  case "${response}" in
    *'"status":"ok"'*) details+=("ok       backend: ${response}") ;;
    *'"status":"degraded"'*)
      details+=("WARNING  backend degradado: ${response}")
      raise 1
      ;;
    *)
      details+=("CRITICAL backend con estado desconocido: ${response}")
      raise 2
      ;;
  esac
else
  details+=("CRITICAL el backend no responde")
  raise 2
fi

# 2. Contenedores.
if containers="$(${COMPOSE_CMD} ps -a --format '{{.Service}}|{{.State}}|{{.Health}}' 2> /dev/null)" && [[ -n "${containers}" ]]; then
  while IFS='|' read -r service state health; do
    [[ -n "${service}" ]] || continue
    # Los servicios de una sola ejecución (perfil tools) terminan a propósito.
    [[ "${service}" == "migrate" ]] && continue
    if [[ "${state}" != "running" ]]; then
      details+=("CRITICAL contenedor ${service}: ${state}")
      raise 2
    elif [[ "${health}" == "unhealthy" ]]; then
      details+=("WARNING  contenedor ${service}: no pasa su healthcheck")
      raise 1
    fi
  done <<< "${containers}"
  details+=("ok       contenedores revisados: $(grep -c '|' <<< "${containers}")")
else
  details+=("WARNING  no se pudo listar los contenedores")
  raise 1
fi

# 3. Antigüedad de la última copia.
if [[ -f "${BACKUP_DIR}/LATEST" ]]; then
  stamp="$(tr -d '\r\n' < "${BACKUP_DIR}/LATEST")"
  # 20261110T032159Z -> 2026-11-10T03:21:59Z
  iso="${stamp:0:4}-${stamp:4:2}-${stamp:6:2}T${stamp:9:2}:${stamp:11:2}:${stamp:13:2}Z"
  if then_s="$(date -u -d "${iso}" +%s 2> /dev/null)"; then
    age_h=$((($(date -u +%s) - then_s) / 3600))
    if ((age_h > BACKUP_MAX_AGE_HOURS)); then
      details+=("WARNING  la última copia tiene ${age_h} h (máximo ${BACKUP_MAX_AGE_HOURS} h)")
      raise 1
    else
      details+=("ok       última copia hace ${age_h} h")
    fi
  else
    details+=("WARNING  no se pudo leer la fecha de la última copia (${stamp})")
    raise 1
  fi
else
  details+=("WARNING  no hay copias de seguridad en ${BACKUP_DIR}")
  raise 1
fi

# 4. Disco.
for path in "${BACKUP_DIR}" /var/lib/docker; do
  [[ -d "${path}" ]] || continue
  used="$(df -P "${path}" | awk 'NR==2 {gsub("%", "", $5); print $5}')"
  if [[ -n "${used}" ]] && ((used > DISK_MAX_PERCENT)); then
    details+=("WARNING  disco de ${path} al ${used} % (máximo ${DISK_MAX_PERCENT} %)")
    raise 1
  elif [[ -n "${used}" ]]; then
    details+=("ok       disco de ${path} al ${used} %")
  fi
done

case "${level}" in
  0) echo "OK - Smart LMS funciona" ;;
  1) echo "WARNING - Smart LMS requiere atención" ;;
  *) echo "CRITICAL - Smart LMS tiene un problema" ;;
esac
printf '%s\n' "${details[@]}"
exit "${level}"
