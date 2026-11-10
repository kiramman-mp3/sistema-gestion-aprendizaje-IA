# Interfaces del plugin: chat, analítica y relación de actividades

Implementación de la parte del plugin de los Sprints 9 a 11. Todas las pantallas están construidas contra el
contrato de [`docs/api/openapi.yaml`](../api/openapi.yaml) y probadas en un DOM simulado; las que dependen de la
línea de IA (chat, analítica, recomendaciones) se pueden ver y probar en Moodle con la API simulada
(`pnpm mock:ai`, ver [integración con la línea de IA](../equipo/integracion-con-ia.md)).

La página del asistente (`index.php?courseid=<id>`) llama a un módulo AMD por pantalla; cada uno trabaja sobre
su región de la plantilla y se oculta si el docente no tiene la capacidad que necesita.

| Pantalla                | Módulo (`amd/src/`) | Lógica pura          | Capacidad que exige                    | Backend que usa                                                                                      |
| ----------------------- | ------------------- | -------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Chat                    | `chat.js`, `sse.js` | `chat_model.js`      | `use`                                  | `POST /assistant/chat`, `GET /assistant/conversations/:id`                                           |
| Panel del docente       | `analytics.js`      | `analytics_model.js` | `viewanalytics`                        | `GET /analytics/courses/:id`                                                                         |
| Análisis del estudiante | `analytics.js`      | `analytics_model.js` | `viewanalytics`                        | `GET /analytics/.../students/:id`, `POST .../recommendations`, `POST /recommendations/:id/followups` |
| Actividades y unidades  | `mapping.js`        | `mapping_model.js`   | `use` para ver, `publish` para cambiar | `GET`, `PUT` y `DELETE /courses/:id/activity-mappings`                                               |

Las funciones AJAX de Moodle que las apoyan se ejecutan con la sesión del docente, no con la del usuario de
integración:

| Función                                    | Capacidad       | Para qué                                                                              |
| ------------------------------------------ | --------------- | ------------------------------------------------------------------------------------- |
| `local_ai_assistant_get_course_students`   | `viewanalytics` | Nombres de los estudiantes activos; **los nombres no pasan por el backend** (ADR-010) |
| `local_ai_assistant_get_course_activities` | `use`           | Actividades del curso (sin etiquetas), con sección y visibilidad                      |

## Chat

- **Streaming sobre `fetch`.** `EventSource` no admite POST ni cabeceras, así que `sse.js` lee el cuerpo de la
  respuesta y separa los eventos (CRLF, comentarios, varias líneas `data`, caracteres multibyte partidos entre
  trozos). `streamBackend` (en `assistant.js`) usa un token nuevo, como el resto de llamadas; si el backend
  responde JSON en lugar de un flujo, lo entrega como un único `final`.
- **Eventos.** `tool`, `token`, `final` y `error`, con el formato que fija el contrato. El `final` reemplaza el
  texto de los tokens. Un flujo que termina sin `final` ni `error` se marca como interrumpido; nunca se presenta
  como respuesta completa.
- **Qué muestra.** El texto (siempre como texto, nunca HTML), lo que consulta mientras responde, las fuentes con
  enlaces a Moodle, la fecha de la consulta y el aviso de datos incompletos. Los errores se explican sin inventar
  respuesta: límite de uso (429), proveedor caído (503), sin permiso (403), interrumpida y desconocido.
- **Conversación.** Se conserva el `conversationId` en `sessionStorage` (solo esa pestaña) y se recupera con
  `GET /assistant/conversations/:id`; "Nueva conversación" lo olvida. "Detener" cancela la respuesta en curso.
- **Entrada.** Enter envía y Shift+Enter hace un salto de línea; máximo 2000 caracteres; un doble envío no manda
  dos preguntas.

## Panel del docente y análisis del estudiante

- **Indicadores** con su definición visible y un valor ausente como guion, nunca como cero. **Señales** agrupadas
  por estudiante (más señales primero), cada una con su regla y su explicación; una regla que el plugin no
  conoce se muestra con su código. El panel recuerda que una señal no es un diagnóstico.
- **Nombres.** Las señales y evidencias traen solo el id; el plugin pide los nombres a Moodle. Si falla, se
  muestran los ids con un aviso, y un estudiante que ya no está en el curso no pierde su señal.
- **Evidencias** separadas en observado en Moodle, calculado y lo que falta para concluir (`unknown`).
- **Recomendaciones** (RF-18): se muestran solo las partes con contenido, con el aviso de que son sugerencias
  y no un diagnóstico; "datos insuficientes" (422) y proveedor caído (503) se explican sin inventar nada. El
  validador de lenguaje que impide diagnósticos lo construye la línea de IA; la interfaz solo presenta lo que
  el backend aprueba.
- **Seguimiento** (RF-20): qué hizo el docente y, opcionalmente, qué ocurrió; la acción es obligatoria.

## Relación de actividades con unidades

Es la base de los indicadores por unidad y de la herramienta `get_unit_performance` del chat.

- Las unidades y los resultados salen del sílabo **revisado** más reciente del curso (`REVIEWED`).
- Las actividades creadas al publicar una propuesta se relacionan solas (`source: PROPOSAL`), con la unidad y los
  resultados de la propuesta; no se sobrescribe lo que el docente ya eligió a mano (`MANUAL`). Si la relación
  automática falla, la publicación no se detiene.
- El docente completa el resto en la pantalla: elegir una unidad guarda al instante y propone los resultados que
  el sílabo le asigna; marcar un resultado guarda la lista; "Sin relacionar" quita la relación. Una relación que
  apunta a una unidad o un resultado que ya no están en el sílabo se marca para elegir de nuevo.
- Sin sílabo revisado la pantalla explica qué falta; sin `publish` se puede ver pero no cambiar.
- El backend valida la unidad y los resultados contra el sílabo, pero no que el `cmId` exista en Moodle: la
  relación está acotada al curso del token, así que un id ajeno no afecta a otro curso.

## Pruebas

| Capa                     | Archivo (`infra/amd/tests/`)              | Qué cubre                                                               |
| ------------------------ | ----------------------------------------- | ----------------------------------------------------------------------- |
| Chat                     | `chat_model`, `chat` y el lector SSE      | Eventos, fuentes, errores, conversación, detener, texto seguro          |
| Analítica                | `analytics_model`, `analytics`            | Indicadores, señales, nombres, evidencias, recomendaciones, seguimiento |
| Relación de actividades  | `mapping` (modelo y pantalla)             | Filas, guardado inmediato, quitar, solo lectura, relaciones obsoletas   |
| Contrato de la API de IA | `mock_api`                                | Formato SSE, esquema v1, códigos de error de la API simulada            |
| API de relaciones        | `apps/api/test/mappings.e2e-spec.ts` (27) | Unidades, validación, permisos, aislamiento por curso, auditoría        |
| Funciones de Moodle      | `tests/external/get_course_*_test.php`    | Estudiantes y actividades, permisos, matrículas suspendidas             |

## Pendiente

- Verificar las pantallas de la línea de IA en Moodle con la API real (hoy, con la simulada y en un DOM simulado).
- Panel con evolución en el tiempo (snapshots, Sprint 10): el contrato actual solo trae indicadores del momento.
- Capturas de las pantallas para el README y el manual del docente.
