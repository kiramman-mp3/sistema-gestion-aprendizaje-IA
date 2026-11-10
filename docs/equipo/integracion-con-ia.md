# Integración con la línea de IA (Pashma)

Qué está listo del lado de José para que Pashma construya su parte y se integren después, qué espera cada
pantalla de la API, y cómo comprobar la integración. Complementa [el reparto del trabajo](reparto-trabajo.md).

## Cómo trabajar en paralelo

1. El contrato es [`docs/api/openapi.yaml`](../api/openapi.yaml) más los esquemas de `packages/contracts`. Si algo
   debe cambiar, se cambia ahí primero y se avisa; las dos partes avanzan contra el mismo contrato.
2. Con la API real y el proveedor de demostración (`AI_PROVIDER=mock pnpm --filter @smart-lms/api dev`), el
   curso de prueba `AN-401-PRUEBA` y el plugin apuntando a `http://localhost:3000/api/v1`, `pnpm smoke:publicacion` y
   `pnpm smoke:asistente` verifican la integración. Antes, o para probar la interfaz sin la API real, se usa la
   **API simulada**:

   ```bash
   pnpm --filter @smart-lms/contracts build     # una vez, para que el simulador use los esquemas
   pnpm mock:ai                                  # http://localhost:3100/api/v1 (MOCK_PORT para cambiarlo)
   bash infra/scripts/moodle.sh compose exec -T webserver php /var/www/html/admin/cli/cfg.php \
     --component=local_ai_assistant --name=backendurl --set=http://localhost:3100/api/v1
   ```

   El simulador acepta llamadas desde cualquier origen y no verifica el token. Con él el docente puede abrir `index.php?courseid=<id>&syllabusid=00000000-0000-4000-8000-0000000000a1`
   para recorrer la extracción, y usar el chat y el panel. Para volver al backend real:
   `--set=http://localhost:3000/api/v1`. Las propuestas, la publicación y las relaciones **no** están en el
   simulador: son del backend real.

3. Las pruebas de `infra/amd/tests/mock_api.test.mjs` fijan lo que el simulador cumple; son la lista de
   comprobación de lo que la implementación real debe cumplir (formato de eventos, esquema v1, códigos).

## Lo que cada pantalla espera de Pashma

| Pantalla (José)              | Ruta que debe existir                           | Lo que la pantalla espera                                                                                                                   |
| ---------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Carga y extracción (S5)      | `POST /syllabi/:id/extract`                     | 202 y el sílabo. Después `GET /syllabi/:id` pasa a `EXTRACTED` o `FAILED` (puede pasar por `PROCESSING`)                                    |
| Editor de la extracción (S5) | `GET /syllabi/:id/extraction[?version=]`        | `{version, source, content, consistencyIssues, createdAt}`; `content` cumple el esquema v1                                                  |
|                              | `PUT /syllabi/:id/extraction`                   | Cuerpo: extracción v1. 201 con la versión nueva (`source: TEACHER`); el sílabo pasa a `REVIEWED`; 400 con `details` si no cumple el esquema |
| Propuestas (S6)              | `POST /proposals`                               | Exige que el sílabo esté `REVIEWED`: lo deja así la ruta `PUT` anterior                                                                     |
| Chat (S8–S9)                 | `POST /assistant/chat` (SSE)                    | Eventos `tool`, `token`, `final` o `error` con el formato del contrato; errores previos como JSON (403, 429, 503)                           |
|                              | `GET /assistant/conversations/:id`              | `{id, courseId, messages[{role, content, createdAt}]}`; 404 si es de otro usuario (SEC-10)                                                  |
| Panel del docente (S10–S11)  | `GET /analytics/courses/:courseId`              | `indicators` (cada uno con `definition`; `value: null` si falta el dato) y `signals` con `explanation`                                      |
| Análisis del estudiante      | `GET /analytics/courses/:courseId/students/:id` | `observed`, `computed` y `unknown` separados                                                                                                |
|                              | `POST .../recommendations`                      | 201 con las partes de `Recommendation`; 422 si faltan datos; 503 si el proveedor no responde                                                |
|                              | `POST /recommendations/:id/followups`           | 201; `actionTaken` obligatorio                                                                                                              |

Además:

- **Códigos de error** con el formato `{code, message, details?}` del contrato; la pantalla distingue
  `RATE_LIMITED` (429), `AI_PROVIDER_UNAVAILABLE` (503), `FORBIDDEN*` (403), `INSUFFICIENT_DATA` (422) y
  `STREAM_INTERRUPTED` (generado en el navegador).
- **Capacidades.** `use` para el chat; `viewanalytics` para la analítica. El backend ya aplica
  `@RequireCapability` y el aislamiento por curso (`CourseAccessGuard`); las rutas nuevas con `:courseId` heredan
  la comprobación de que el curso de la ruta es el del token.
- **Nombres de estudiantes.** Nunca llegan al backend ni al proveedor: las señales y evidencias usan solo el id
  de Moodle y el plugin pide los nombres a Moodle.
- **Herramientas del chat sobre actividades (D-05).** Los tipos de actividad que el plugin crea son `assign`,
  `forum`, `quiz`, `label` y `page` (provisional). La relación actividad ↔ unidad que necesita
  `get_unit_performance` está en la tabla `activity_unit_mappings`: se llena sola al publicar y a mano desde la
  pantalla (`GET /courses/:courseId/activity-mappings` devuelve unidades y relaciones).
- **Límite de peticiones.** El backend ya limita las peticiones por usuario (`RATE_LIMIT_PER_MINUTE`, 120 por
  defecto) y responde 429 con `Retry-After`. El límite de uso y costo de IA por docente (RNF-07) es de Pashma y debe
  usar el mismo código `RATE_LIMITED`.
- **Interfaz `LlmProvider` y seudonimización** (ADR-009, ADR-010): del lado de Pashma. El plugin no envía nombres.

## Utilidades ya hechas que conviene reutilizar

| Qué                                   | Dónde                                               | Para qué                                                                                             |
| ------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Extracción de ejemplo y fixtures      | `packages/contracts` (`buildSyllabusExtraction`)    | Pruebas del extractor y del generador; se exporta desde el índice                                    |
| `findConsistencyIssues`               | `packages/contracts`                                | El plugin lo replica en JavaScript y una prueba compara ambos                                        |
| Validación de cuerpos con Zod         | `apps/api/src/common/parse-body.ts`                 | 400 con `details` en el formato del contrato                                                         |
| Base de datos en memoria para pruebas | `apps/api/test/support/proposals-store.ts` (modelo) | Patrón para probar servicios sin PostgreSQL; las pruebas con base real son opt-in (`RUN_DB_TESTS=1`) |
| Cola y worker en el backend           | `apps/api/src/proposals/publish-dispatcher.ts`      | Patrón de cola BullMQ con trabajo idempotente y reintentos                                           |
| Auditoría                             | `AuditService`                                      | Acciones `dominio.verbo`, solo metadatos escalares, sin datos personales                             |
| Prueba de carga                       | `infra/loadtest/load.mjs --scenario chat`           | Mide el primer evento (RNF-01) y el evento final (RNF-02) con el proveedor real                      |

## Lista de comprobación para integrar

- [ ] Las pruebas de `mock_api.test.mjs` describen lo que la API real cumple (formato SSE, códigos, esquema v1).
- [ ] `pnpm --filter @smart-lms/plugin-js test` sigue en verde con los cambios de contrato.
- [ ] En Moodle, con la API real: subir un sílabo → extraer → editar y guardar → generar propuesta → aprobar →
      publicar. Hecho el tramo de la propuesta a Moodle (`pnpm smoke:publicacion`); falta la carga y la extracción
      reales, que necesitan ClamAV y el worker documental.
- [x] Chat con la API real (`pnpm smoke:asistente`): pregunta con herramienta (pendientes y notas coinciden con
      Moodle, sin la nota oculta), `data.students` con seudónimos, historial sin nombres, 404 y 400.
- [x] Chat: una pregunta con datos incompletos, el 429, el 503 y la interrupción con la API real (están probados en la
      pantalla con el simulador). Hecho con la API y Gemini reales (`pnpm smoke:ia`): el chat con herramientas, la
      aclaración, las evidencias y los ataques ([resultados](../resultados/ia-real-sintetica.md)). El 429, el 503 y la
      interrupción se probaron en el navegador con el backend real ([pruebas de pantalla](../resultados/pruebas-de-pantalla.md)).
- [ ] Panel: indicadores con un valor nulo, señales con explicación, evidencias y recomendación con 422. Hecho con la
      API real: indicadores con definición, señales con explicación y evidencias separadas (`pnpm smoke:asistente`);
      faltan el valor nulo y la recomendación con 422.
- [ ] Medir RNF-01 y RNF-02 con `pnpm loadtest -- --scenario chat` y registrar los resultados. Hay una medición
      orientativa con 6 muestras y el plan gratuito (RNF-02 dentro del objetivo, RNF-01 fuera); falta con más muestras.
- [ ] Revisar con José los casos de seguridad SEC-06 y SEC-07 sobre la interfaz. Los dos casos se probaron con el modelo
      real a nivel de API (`pnpm smoke:ia`); falta la revisión sobre la interfaz.

## Entre los dos

| Necesita                               | De     | Estado                                                               |
| -------------------------------------- | ------ | -------------------------------------------------------------------- |
| API de extracción real                 | Pashma | Hecha; con `AI_PROVIDER=mock` devuelve el sílabo de ejemplo          |
| `POST /assistant/chat` con streaming   | Pashma | Hecha; con `AI_PROVIDER=mock` responde con datos de las herramientas |
| `GET /analytics/...` y recomendaciones | Pashma | Hechas y verificadas con Moodle real y `AI_PROVIDER=mock`            |
| Funciones de lectura de Moodle         | José   | Hechas ([detalle](../architecture/lecturas-moodle.md))               |
| Curso de prueba `AN-401-PRUEBA`        | José   | Hecho (`seed_curso_prueba.php`)                                      |
| Sílabos reales (D-03)                  | José   | Pendiente con la institución; hoy solo hay el sílabo de ejemplo      |
| Tipos de actividad (D-05)              | José   | Provisional: `assign`, `forum`, `quiz`, `label`, `page`              |
| Relación actividad ↔ unidad            | José   | Hecha: API, pantalla y registro automático al publicar               |
