# Reparto del trabajo restante

Trabajo pendiente del [roadmap](../ROADMAP.md) a partir del Sprint 5, repartido entre **Pashma** y
**José**. Los sprints 0 a 4 están terminados en la parte técnica; quedan pendientes las tareas con la
institución que se listan al final.

## Criterio

El trabajo se divide en dos líneas para que cada persona sea dueña de módulos distintos y los pull
requests no choquen:

| Línea                          | Responsable | Dónde trabaja                                                                                               |
| ------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------- |
| IA, datos y analítica          | Pashma      | `apps/api` (LLM, extracción, chat, RAG, analítica), `packages/contracts`, evaluación de IA                  |
| Moodle, publicación e interfaz | José        | `moodle/local/ai_assistant` (PHP, plantillas, AMD), propuestas y publicación en `apps/api`, infraestructura |

Cada tarea se hace en la rama indicada, con PR a `develop` revisado por la otra persona (ver
[CONTRIBUTING](../../CONTRIBUTING.md)). Cuando una tarea depende de otra línea, se acuerda primero el
contrato (esquema en `packages/contracts` y ruta en `docs/api/openapi.yaml`) y cada uno avanza contra
ese contrato con datos de prueba.

## Pashma — IA, datos y analítica

### Sprint 5 · Extracción estructurada con IA (hito H2)

- [x] `feature/llm-provider-abstraction`: interfaz `LlmProvider` con salida estructurada, límites de tokens, timeouts y registro de consumo; un proveedor simulado para pruebas mientras se decide D-07.
- [x] `feature/syllabus-structured-extraction`: del texto (`extracted_text`) al esquema v1 validado con Zod, con `uncertainFields` y `sourceReferences` con página; sin inventar fechas, ponderaciones ni actividades.
- [x] Defensa contra prompt injection: el texto del documento va delimitado como datos.
- [x] `feature/extraction-versioning`: `POST /syllabi/:id/extract`, `GET` y `PUT /syllabi/:id/extraction` y versiones en `syllabus_extractions`.
- [ ] Conjunto de referencia y primera medición de precisión, exhaustividad y F1. El medidor está hecho (`pnpm eval:extraction`) y hay 12 sílabos **sintéticos** con su extracción esperada (`tests/fixtures/synthetic-syllabi`), que sirven para ejercitar el flujo y medir el texto extraído (99,6 %) pero **no valen para la tesis**; faltan los sílabos reales (D-03) y un proveedor de IA.

### Sprint 8 · Asistente conversacional

- [x] `feature/ai-orchestrator`: bucle de tool calling con límite de iteraciones y herramientas de lectura y escritura separadas.
- [ ] `feature/tool-teacher-courses`, `feature/tool-submissions`, `feature/tool-pending-grading` y `feature/tool-grade-summary` en el backend. Código hecho y probado con un Moodle simulado, y las funciones de lectura del plugin ya existen ([lecturas de Moodle](../architecture/lecturas-moodle.md)). Verificadas con Moodle real y el proveedor de demostración: `get_course_activities`, `get_pending_grading` y `get_grade_summary`; falta `get_assignment_submissions` en el chat (el proveedor de demostración no la elige) y `get_teacher_courses` (el token fija un solo curso).
- [x] `feature/pseudonymization` (ADR-010).
- [x] `feature/chat-api`: `POST /assistant/chat` con streaming e historial.

### Sprint 9 · RAG

- [x] `feature/rag-indexing` con `pgvector` y `feature/tool-search-documents` filtrando por curso ([ADR-019](../architecture/adr/0019-rag-embeddings-pgvector.md)), con embeddings de demostración; falta el modelo real (D-07) y medir la calidad de la recuperación.
- [x] Degradación controlada si el proveedor LLM no responde y límites de uso y costo por docente (mensajes y tokens; el costo en dinero espera a D-07).
- [x] Pruebas de ataque del chat: documento con instrucciones maliciosas, datos de otro curso y conversación ajena (con modelo simulado; repetir con el proveedor real).

### Sprints 10 y 11 · Analítica y asistente pedagógico

- [x] `feature/analytics-indicators`, `feature/difficulty-signals` y `feature/analytics-api`, verificados con Moodle real. `feature/analytics-snapshots` hecha bajo demanda, uno por día y docente ([ADR-021](../architecture/adr/0021-snapshots-de-indicadores-bajo-demanda.md)). Reglas administrables por API (`/admin/difficulty-rules`, [ADR-020](../architecture/adr/0020-capacidad-administer-y-rutas-de-administracion.md)).
- [x] Herramienta `get_unit_performance` para el chat.
- [x] `feature/student-evidence` y `feature/pedagogical-recommendations` con el validador de lenguaje (sin diagnósticos ni etiquetas): la ruta de evidencias, la herramienta `get_student_learning_evidence` del chat (exige `viewanalytics`), la generación con el validador y los pasajes del sílabo, `POST /analytics/courses/:courseId/students/:studentId/recommendations` y `POST /recommendations/:id/followups`. Falta medir la pertinencia con un modelo real.

### Sprint 12 · Evaluación

- [ ] Evaluación de calidad de IA sobre el conjunto de referencia (sección 13.3 de los requisitos).
- [ ] Evaluación de recomendaciones y casos de seguridad de IA (SEC-06, SEC-07). **Parcial:** SEC-06 y SEC-07 están automatizados con un modelo simulado que obedece al atacante, también para la búsqueda en documentos; falta repetirlos con el proveedor real y evaluar las recomendaciones con docentes.

### Con la institución

- [ ] D-07: comparar proveedores de IA (costo, privacidad, salida estructurada) y proponer uno.
- [ ] D-08: política de datos personales y plazos de retención.
- [ ] Aval ético y consentimiento informado para el piloto.

## José — Moodle, publicación e interfaz

### Sprint 5 · Editor de la extracción

- [x] `feature/plugin-extraction-editor`: editor de unidades, temas, resultados, fechas y ponderaciones con indicador de confianza. Se puede empezar con las extracciones de ejemplo de `packages/contracts` antes de que exista la API.

### Sprint 6 · Propuestas

- [x] `feature/proposal-generator`: unidades a secciones y actividades a tipos de Moodle según D-05, vinculadas a unidades y resultados.
- [x] Validación de ponderaciones contra la configuración institucional (D-04), con política provisional.
- [x] `feature/proposal-state-machine` y `feature/proposal-api` (`POST /proposals`, `GET`, `PATCH`, `POST /proposals/:id/approve`).
- [x] `feature/plugin-proposal-preview`: vista previa editable.

### Sprint 7 · Publicación en Moodle (hito H3)

- [x] `feature/moodle-create-section` y `feature/moodle-create-module` en el plugin (funciones externas con validación de parámetros y capacidades).
- [x] `feature/publish-job`: publicación idempotente en la cola, ítem por ítem, con reanudación tras fallos parciales.
- [x] `feature/plugin-publish-summary` y confirmación explícita antes de publicar.
- [x] Pruebas: publicación repetida, caída de Moodle a mitad y permisos insuficientes.

### Sprints 9 a 11 · Interfaces en Moodle

- [x] `feature/plugin-chat-ui`: chat con streaming, fuentes y errores.
- [x] `feature/activity-unit-mapping`: mapeo manual de actividades a unidades y resultados.
- [x] `feature/plugin-teacher-dashboard`: panel con indicadores y alertas explicables.
- [x] `feature/plugin-student-analysis` y `feature/recommendation-follow-up`.

### Sprint 12 · Pruebas

- [x] Pruebas end-to-end de CU-01 a CU-07 con el proveedor de demostración: `pnpm smoke:silabos` (CU-01), `smoke:publicacion` (CU-02, CU-03) y `smoke:asistente` (CU-04, CU-05, CU-06, CU-07). Falta repetirlas con el proveedor real.
- [x] Prueba de carga básica y revisión OWASP Top 10 ([resultados](../security/revision-owasp.md)). Con el proveedor de IA real faltan RNF-01 a RNF-03.
- [ ] Piloto con docentes: medición frente a la línea base, encuesta SUS y entrevistas.

### Sprint 13 · Despliegue

- [x] `chore/production-compose` con TLS, límites de recursos y secretos fuera del repositorio.
- [x] Copias de seguridad cifradas con prueba de restauración, monitoreo básico y procedimiento de incidentes.
- [x] Manual de instalación y operación, manual del docente, manual del administrador y guion de capacitación (`docs/operacion/`, `docs/user-manual/`); capítulos técnicos de la tesis (`docs/thesis/`). Falta impartir la capacitación (depende del piloto).

### Con la institución

- [ ] D-03: reunir los sílabos reales para el conjunto de referencia (sin datos personales).
- [ ] D-04 y D-05: reglamento de ponderaciones y tipos de actividad que se crearán en Moodle.
- [ ] D-09 y D-10: docentes del piloto y calendario.
- [ ] Entrevistas a docentes, línea base de tiempos y validación de los prototipos (Sprint 1).

## Trabajo compartido

- Revisión cruzada de todos los pull requests.
- Cierre de cada sprint en una rama `docs/*`: roadmap, OpenAPI, ADR y README.
- Capítulos técnicos de la tesis (`docs/thesis/`) y versión `v1.0.0` al cerrar el Sprint 13.

## Dependencias entre líneas

| Necesita                                      | De     | Para                                                 |
| --------------------------------------------- | ------ | ---------------------------------------------------- |
| API de extracción (`/syllabi/:id/extraction`) | Pashma | Editor de la extracción (José, S5)                   |
| Extracción aprobada y versionada              | Pashma | Generador de propuestas (José, S6)                   |
| `POST /assistant/chat` con streaming          | Pashma | Chat en Moodle (José, S9)                            |
| `GET /analytics/...`                          | Pashma | Panel y análisis del estudiante (José, S10–S11)      |
| Sílabos reales (D-03)                         | José   | Conjunto de referencia y F1 (Pashma, S5)             |
| Tipos de actividad (D-05)                     | José   | Herramientas del chat sobre actividades (Pashma, S8) |
