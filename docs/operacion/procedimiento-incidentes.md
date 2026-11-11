# Procedimiento de incidentes

Qué hacer cuando algo falla en producción (Sprint 13). Está pensado para quien opera el servidor, con
`COMPOSE="docker compose --env-file .env.production -f docker-compose.prod.yml"` definido en la sesión (ver el
[manual de instalación y operación](instalacion-y-operacion.md)).

## Primero, siempre

1. **Mide**: `infra/monitoring/check-health.sh` y `$COMPOSE ps`. Anota la hora y qué dice.
2. **No borres nada** (volúmenes, copias, registros) hasta saber la causa.
3. **Registra**: abre una nota del incidente con hora de inicio, síntoma, quién lo reportó y cada acción que hagas.
4. **Clasifica** con la tabla de abajo y avisa a quien corresponda.

| Gravedad | Cuándo                                                                                           | Respuesta    | Avisar a                                                         |
| -------- | ------------------------------------------------------------------------------------------------ | ------------ | ---------------------------------------------------------------- |
| Crítica  | Posible fuga de datos o de secretos; contenido publicado por error; el servicio caído para todos | Inmediata    | Responsable del proyecto y de datos personales de la institución |
| Alta     | Una función completa no funciona (publicar, extraer, chat); copias de seguridad que fallan       | En el día    | Responsable del proyecto                                         |
| Media    | Degradación (lentitud, antivirus caído, un contenedor reiniciándose)                             | En 2 días    | Responsable del proyecto                                         |
| Baja     | Avisos de disco, certificados por vencer, dependencias con avisos                                | En la semana | Registro                                                         |

## Síntomas frecuentes

### El monitor dice CRITICAL: el backend no responde

1. `$COMPOSE ps`: ¿qué contenedor no está `running` o `healthy`?
2. `$COMPOSE logs --tail=200 api`. Causas habituales:
   - **Variable de entorno inválida o falta un secreto**: el backend no arranca y nombra la variable (nunca el valor).
   - **Sin antivirus**: en producción no arranca sin `CLAMAV_URL`; `$COMPOSE logs clamav` (el primer arranque tarda minutos).
   - **Base de datos o Redis caídos**: `$COMPOSE logs app-db redis`.
3. `$COMPOSE up -d` vuelve a levantar lo que haya caído. Si sigue fallando, no reconstruyas a ciegas: busca la causa en el registro.

### `health` dice `degraded`

La respuesta nombra la dependencia caída:

| Dependencia | Qué hacer                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `moodle`    | Comprueba que Moodle responda desde el servidor (`curl -I <MOODLE_BASE_URL>`), que el token no haya vencido o rotado y que el servicio web siga habilitado |
| `antivirus` | Las cargas de sílabos fallan cerrado (503). `$COMPOSE restart clamav` y espera a que esté `healthy`                                                        |
| `redis`     | Sin Redis no hay autenticación de tokens (503 para todos). `$COMPOSE restart redis`; la cola se conserva (`appendonly`)                                    |
| `database`  | `$COMPOSE logs app-db`; revisa el espacio en disco                                                                                                         |

### Los docentes ven «No se pudo conectar con el backend» o `TOKEN_INVALID`

- `Failed to fetch`: el backend no responde o el navegador no lo alcanza. Revisa el certificado (`curl -I https://<API_DOMAIN>/api/v1/session` debe
  responder 401, no un error de TLS) y que `CORS_ORIGINS` sea el sitio de Moodle.
- `TOKEN_INVALID`: el secreto del plugin y `PLUGIN_JWT_SECRET` no coinciden, o `MOODLE_BASE_URL` no es el `wwwroot` real.

### Una publicación quedó a medias (propuesta `FAILED`)

No es un desastre: lo creado se conserva y reanudar no duplica nada.

1. Pide al docente que abra la propuesta: la pantalla muestra qué se creó, qué falló y por qué.
2. Causa `MOODLE_UNAVAILABLE`: Moodle no respondió; reanuda cuando vuelva. `MOODLE_PERMISSION`: el docente perdió
   permisos en el curso; corrige el rol y reanuda. `MOODLE_ERROR:<código>`: revisa el registro de Moodle.
3. **Reanudar** desde la pantalla. Si la propuesta quedó en `PUBLISHING` más de unos minutos sin avanzar (el servicio se
   reinició a mitad), `$COMPOSE restart api`: la operación se retoma sola desde el último elemento creado.

### Una publicación creó algo que no debía

1. **Detén la propagación**: pide al docente no volver a publicar esa propuesta.
2. Lo creado está **oculto** para los estudiantes; el docente puede borrarlo desde Moodle. Si se ocultó mal o ya se
   mostró, avisa a la institución (gravedad crítica).
3. Identifica la operación (`publish_operations`) y los elementos (`proposal_items.moodle_item_id`) y la auditoría
   (`audit_events` con `proposal.publish`) para reconstruir quién aprobó y publicó.

### Disco lleno

1. `df -h /var/lib/docker /var/backups`; `docker system df`.
2. Copias: baja `RETENTION_DAYS` o traslada las antiguas a otro almacenamiento (nunca borres la última copia verificada).
3. Imágenes y capas sin uso: `docker image prune`. **No** uses `docker volume prune` ni `docker system prune --volumes`: borrarías datos.

### La copia de seguridad falla o no es reciente

`$COMPOSE ps` (¿está `app-db`?), el registro `/var/log/smart-lms-backup.log`, el espacio en disco y que
`/etc/smart-lms/backup.pass` exista y no esté vacío. Haz una copia manual en cuanto se corrija y ejecuta
`restore-test.sh`.

## Pérdida de datos o corrupción de la base

1. Detén el backend: `$COMPOSE stop api document-worker`.
2. Elige la última copia buena (`restore-test.sh` la verifica) y restáurala según el manual (sección «Restaurar desde
   una copia»). Primero en una base nueva para revisarla; después en `ai_assistant`.
3. Los archivos subidos se restauran aparte con `restore.sh files`.
4. Lo escrito después de la copia se pierde: pide a los docentes volver a guardar lo que hicieron ese día. Moodle no
   se ve afectado (es la fuente de verdad).

## Sospecha de fuga de un secreto

| Secreto                          | Qué hacer                                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `PLUGIN_JWT_SECRET`              | Rotarlo ya (valor nuevo en `api.env` y en el plugin, reinicio). Revisa la auditoría por accesos inusuales               |
| Token de Moodle                  | `setup_integration.php --rotate`, actualizar `MOODLE_TOKEN`; revisa el registro de Moodle del usuario `ai_integration`  |
| Contraseña de la base o de Redis | Cambiar en `db_password`/`redis_password` y en `api.env`/`worker.env`; la base exige `ALTER USER` dentro del contenedor |
| Contraseña de las copias         | Generar otra, hacer una copia nueva y guardar la anterior solo mientras existan copias cifradas con ella                |
| Clave del proveedor de IA        | Revocarla en el proveedor y poner la nueva en `api.env`                                                                 |

Si pudo haber acceso a datos personales, es un incidente **crítico**: avisa de inmediato a la institución, que decide
si corresponde notificar según la LOPDP (ver el [análisis de privacidad](../security/analisis-privacidad.md)).

## Después del incidente

Escribe, en un día, qué pasó, cómo se detectó, cuánto duró, qué se hizo, qué se aprende y qué se cambia (un
control nuevo, una prueba, una alerta). Si el cambio es de código o de configuración, entra por el flujo normal:
rama, pruebas y revisión.
