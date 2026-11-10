# Lo que la línea de IA necesita del plugin y de la institución

Pendientes de **José** (Moodle, interfaz e institución) para que Pashma cierre la línea de IA. Van ordenados
por urgencia. El estado general está en el [reparto del trabajo](reparto-trabajo.md) y lo que ya espera cada
pantalla, en [integración con la línea de IA](integracion-con-ia.md).

## 1. Urgente: funciones de lectura en el plugin

Hoy el usuario de integración solo llama a `check_access` y a las funciones de publicar. Las herramientas del
chat y la analítica necesitan leer entregas y notas. Las funciones siguen el patrón de `publish_module.php`:
reciben `userid` (el docente en cuyo nombre se consulta) y `courseid`. El contrato de las respuestas está en
[`packages/contracts/src/moodle/read.ts`](../../packages/contracts/src/moodle/read.ts) y la decisión en
[ADR-017](../architecture/adr/0017-lecturas-moodle-solo-ids.md).

| Función                                  | Parámetros                    | Debe devolver                                                                                                         |
| ---------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `local_ai_assistant_list_activities`     | `userid`, `courseid`          | `cmid`, `modname`, `name`, `sectionnum`, `visible`, `duedate` y `maxgrade` (nota máxima, si la actividad se califica) |
| `local_ai_assistant_list_students`       | `userid`, `courseid`          | Solo los ids de los matriculados activos (`studentid`), sin nombres                                                   |
| `local_ai_assistant_get_submissions`     | `userid`, `courseid`, `cmid`  | Por estudiante: `studentid`, `status` (`new`, `draft`, `submitted`, `graded`, `missing`), `submittedat` y `late`      |
| `local_ai_assistant_get_pending_grading` | `userid`, `courseid`, `cmid?` | Entregas enviadas y sin calificar: `cmid`, `studentid` y `submittedat`                                                |
| `local_ai_assistant_get_grades`          | `userid`, `courseid`, `cmid?` | `cmid`, `studentid`, `grade` (`null` si no hay), `grademax` y `gradedat`                                              |
| `local_ai_assistant_get_completion`      | `userid`, `courseid`          | Por actividad y estudiante: `completed` y `completedat`                                                               |
| `local_ai_assistant_get_last_access`     | `userid`, `courseid`          | Último acceso al curso por `studentid`                                                                                |

Reglas para todas:

- **Sin datos personales.** Nunca nombres, correos ni cédulas, solo ids. Los esquemas del contrato son
  estrictos: un campo de más, como `fullname`, hace fallar la validación en el backend.
- **Permisos.** Verificar en PHP que `userid` tiene `viewanalytics` en el curso, que el curso existe y está
  activo. Respetar grupos separados y no devolver notas ocultas.
- **Formato.** Cada respuesta es un objeto con `truncated` y la lista. Fechas en ISO-8601 UTC
  (`2026-11-10T15:30:00Z`), notas como número con punto y `null` cuando no hay dato; un `0` no puede significar
  «sin nota».
- **Volumen.** Máximo de 500 filas por llamada (`MOODLE_READ_MAX_ROWS`); si se corta, `truncated: true`.
- **Registro.** Añadirlas a `db/services.php` en el servicio `local_ai_assistant_integration`, dar las
  capacidades al usuario de integración en `infra/moodle/cli/setup_integration.php`, subir `version.php` y
  ejecutar `upgrade.php`.
- **Pruebas.** PHPUnit con un curso de ejemplo, incluido un docente sin permiso.

## 2. Urgente: cambio de contrato en el chat

La respuesta del chat puede traer `data.students`: una lista de `{alias, studentId}`. El texto de `answer`
usa seudónimos `Estudiante#NNNNNNNN`. La pantalla del chat debe:

- **Sustituir cada alias por el nombre real**, pidiéndolo a Moodle por el id con `get_course_students`.
- **Enviar `Accept: text/event-stream`** para recibir los eventos SSE.
- **Manejar los errores previos al flujo:**

| Código                        | Significado                                                     |
| ----------------------------- | --------------------------------------------------------------- |
| 429 `RATE_LIMITED`            | Límite diario de uso por docente; llega `Retry-After`           |
| 503 `AI_PROVIDER_UNAVAILABLE` | El proveedor no responde; no se inventa respuesta               |
| 404 `CONVERSATION_NOT_FOUND`  | Conversación ajena o inexistente                                |
| 400 con `details`             | Mensaje vacío, de más de 2000 caracteres o con formato inválido |

También hay que actualizar `pnpm mock:ai` para que devuelva `data.students`, así el simulador y la API real
coinciden. El detalle del chat está en [asistente conversacional](../architecture/asistente-chat.md).

## 3. Importante: curso de prueba con datos sintéticos

Un Moodle local con un curso que tenga estudiantes ficticios, actividades de varios tipos, entregas completas
e incompletas, notas, completado y accesos. Sin eso no se puede probar de punta a punta ni medir RNF-01 a
RNF-03.

## 4. Decisiones

- **Permiso de administrador.** Para `/admin/difficulty-rules` y `/audit` el token solo tiene `use`,
  `publish` y `viewanalytics`. Propuesta: añadir la capacidad `local/ai_assistant:administer` y que
  `check_access` la devuelva como `admin`.
- **Auditoría.** Quién hace la pantalla y la consulta de `/audit` (CU-07); no está asignada.
- **Tipos de actividad (D-05).** Confirmar que siguen siendo `assign`, `forum`, `quiz`, `label` y `page`; se
  usan en `get_unit_performance`.

## 5. Pendiente con la institución

- **D-03:** sílabos reales, anonimizados y con permiso: entre 10 y 20, con mezcla de PDF y DOCX y algunos
  escaneados para probar el OCR. Sin ellos no se puede medir el F1 de la extracción (`pnpm eval:extraction`).
- **D-09 y D-10:** docentes del piloto y calendario, para la evaluación del Sprint 12.

## Qué desbloquea cada cosa

| Si José entrega                    | La línea de IA puede hacer                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| Funciones de lectura (punto 1)     | Herramientas del chat sobre Moodle real; indicadores y señales de dificultad |
| Cambio de contrato (punto 2)       | Que el docente vea nombres y no seudónimos en el chat                        |
| Curso de prueba (punto 3)          | Probar de punta a punta y medir RNF-01 a RNF-03                              |
| Permiso de administrador (punto 4) | `/admin/difficulty-rules`                                                    |
| Sílabos reales (punto 5)           | Conjunto de referencia y F1                                                  |

Lo mínimo que destraba el trabajo es el punto 1 (al menos `list_activities`, `get_submissions`,
`get_pending_grading` y `get_grades`) y el punto 2.
