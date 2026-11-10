#!/usr/bin/env bash
# Alertas de errores y de consumo de IA (Sprint 13, RNF-07): complementa a check-health.sh.
#
#   infra/monitoring/check-ai-usage.sh
#
# Consulta la base auxiliar (solo lectura) y avisa cuando:
#   1. Hay demasiados errores en la auditoría en la última hora (ERRORS_MAX_PER_HOUR, por defecto 20).
#   2. Un docente se acerca a su tope diario de tokens: más del TOKEN_WARN_PERCENT % (80) de
#      AI_DAILY_TOKENS_PER_TEACHER en las últimas 24 horas.
#   3. El consumo total de tokens de las últimas 24 horas pasa de TOKENS_ALERT_DAILY (por defecto 5 000 000). El
#      costo en dinero depende del precio del proveedor (D-07): con el modelo elegido se ajusta este tope.
#   4. Hay muchos rechazos por límite de peticiones o de uso (LIMITED_MAX_PER_HOUR, por defecto 50): un abuso o un
#      tope mal calibrado.
# No muestra ids de docentes ni de cursos: solo cantidades. El detalle por docente está en la base.
#
# Salida (convención de Nagios): una línea de resumen y, debajo, el detalle.
#   0 OK    1 WARNING    2 CRITICAL (no se pudo consultar la base)
#
# Variables:
#   PSQL_CMD                  Comando que ejecuta psql sin formato (-At) y lee la consulta de la entrada estándar.
#                             Por defecto: docker compose ... exec -T app-db psql -U <usuario> -d <base> -At
#   COMPOSE_CMD               Por defecto: docker compose --env-file .env.production -f docker-compose.prod.yml
#   AI_DAILY_TOKENS_PER_TEACHER, TOKEN_WARN_PERCENT, TOKENS_ALERT_DAILY, ERRORS_MAX_PER_HOUR, LIMITED_MAX_PER_HOUR
#
# Cron cada 15 minutos, con aviso por correo solo cuando algo falla:
#   */15 * * * * cd /opt/smart-lms && infra/monitoring/check-ai-usage.sh > /tmp/smart-lms-ai.txt || mail -s "Smart LMS IA" admin@ejemplo.edu.ec < /tmp/smart-lms-ai.txt
set -uo pipefail

COMPOSE_CMD="${COMPOSE_CMD:-docker compose --env-file .env.production -f docker-compose.prod.yml}"
PSQL_CMD="${PSQL_CMD:-${COMPOSE_CMD} exec -T app-db sh -c 'psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At'}"
TOKENS_PER_TEACHER="${AI_DAILY_TOKENS_PER_TEACHER:-500000}"
TOKEN_WARN_PERCENT="${TOKEN_WARN_PERCENT:-80}"
TOKENS_ALERT_DAILY="${TOKENS_ALERT_DAILY:-5000000}"
ERRORS_MAX_PER_HOUR="${ERRORS_MAX_PER_HOUR:-20}"
LIMITED_MAX_PER_HOUR="${LIMITED_MAX_PER_HOUR:-50}"

level=0
details=()
raise() {
  local new="$1"
  ((new > level)) && level="${new}"
}

# Una consulta que devuelve un solo número.
number() {
  local out
  out="$(printf '%s' "$1" | eval "${PSQL_CMD}" 2> /dev/null | tr -d '[:space:]')" || return 1
  [[ "${out}" =~ ^[0-9]+$ ]] || return 1
  printf '%s' "${out}"
}

errors="$(number "SELECT count(*) FROM audit_events WHERE outcome = 'ERROR' AND created_at > now() - interval '1 hour';")" || errors=""
if [[ -z "${errors}" ]]; then
  details+=("CRITICAL no se pudo consultar la base de datos")
  raise 2
else
  if ((errors > ERRORS_MAX_PER_HOUR)); then
    details+=("WARNING  ${errors} errores en la última hora (máximo ${ERRORS_MAX_PER_HOUR})")
    raise 1
  else
    details+=("ok       errores en la última hora: ${errors}")
  fi

  limited="$(number "SELECT count(*) FROM audit_events WHERE action IN ('rate.limited', 'assistant.quota_exceeded') AND created_at > now() - interval '1 hour';")" || limited=0
  if ((limited > LIMITED_MAX_PER_HOUR)); then
    details+=("WARNING  ${limited} rechazos por límite en la última hora (máximo ${LIMITED_MAX_PER_HOUR})")
    raise 1
  else
    details+=("ok       rechazos por límite en la última hora: ${limited}")
  fi

  total="$(number "SELECT coalesce(sum(coalesce(tokens_in, 0) + coalesce(tokens_out, 0)), 0) FROM ai_messages WHERE created_at > now() - interval '24 hours';")" || total=0
  if ((total > TOKENS_ALERT_DAILY)); then
    details+=("WARNING  ${total} tokens de IA en 24 horas (alerta en ${TOKENS_ALERT_DAILY})")
    raise 1
  else
    details+=("ok       tokens de IA en 24 horas: ${total}")
  fi

  threshold=$((TOKENS_PER_TEACHER * TOKEN_WARN_PERCENT / 100))
  near="$(number "SELECT count(*) FROM (SELECT c.moodle_user_id FROM ai_messages m JOIN ai_conversations c ON c.id = m.conversation_id WHERE m.created_at > now() - interval '24 hours' GROUP BY c.moodle_user_id HAVING sum(coalesce(m.tokens_in, 0) + coalesce(m.tokens_out, 0)) > ${threshold}) t;")" || near=0
  if ((near > 0)); then
    details+=("WARNING  ${near} docente(s) pasan del ${TOKEN_WARN_PERCENT}% de su tope diario de tokens (${TOKENS_PER_TEACHER})")
    raise 1
  else
    details+=("ok       ningún docente cerca de su tope diario de tokens")
  fi
fi

case "${level}" in
  0) summary="OK - errores y consumo de IA dentro de lo esperado" ;;
  1) summary="WARNING - revisar el consumo o los errores de IA" ;;
  *) summary="CRITICAL - no se pudo revisar el consumo de IA" ;;
esac
echo "${summary}"
printf '%s\n' "${details[@]}"
exit "${level}"
