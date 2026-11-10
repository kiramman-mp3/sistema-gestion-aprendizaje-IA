# Lo que la línea de IA necesita del plugin y de la institución

Pendientes de **José** (Moodle, interfaz e institución) para que Pashma cierre la línea de IA. Van ordenados
por urgencia. El estado general está en el [reparto del trabajo](reparto-trabajo.md) y lo que ya espera cada
pantalla, en [integración con la línea de IA](integracion-con-ia.md).

## 1. Hecho: funciones de lectura en el plugin

> [!NOTE]
> Hechas y verificadas el 2026-11-10: las siete funciones, la capacidad `local/ai_assistant:readdata` para el
> usuario de integración, 18 pruebas de PHPUnit (incluido un docente sin permiso) y una verificación por REST con el
> token real. Lo que sigue describe lo que se pidió; el detalle de lo construido está en
> [lecturas de Moodle](../architecture/lecturas-moodle.md).

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

## 2. Hecho: cambio de contrato en el chat

> [!NOTE]
> Hecho el 2026-11-10: la pantalla sustituye cada alias por el nombre que da `get_course_students`, muestra los
> segundos de `Retry-After` en el 429, devuelve la pregunta al cuadro y empieza una conversación nueva con el 404, y
> lista los campos del 400. `pnpm mock:ai` devuelve `data.students`. Para que el navegador pueda leer `Retry-After`,
> el backend ahora lo expone en CORS (`exposedHeaders`).

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

## 2.1 Integración con la API real

Con `AI_PROVIDER=mock` y las funciones de lectura ya hechas, el chat, la analítica y la publicación funcionan de
punta a punta con Moodle real: `pnpm smoke:publicacion` y `pnpm smoke:asistente` pasan.

Con `AI_PROVIDER=mock` en el `.env`, el backend responde con datos de demostración: la extracción devuelve el
sílabo de ejemplo (las fechas y ponderaciones que el documento subido no trae quedan anuladas y marcadas para
revisión), el chat consulta una herramienta según palabras clave y las recomendaciones traen un texto de
ejemplo. Cada respuesta de chat y de recomendación lleva el aviso «Respuesta de demostración». No vale para
medir calidad ni tiempos, y no se permite en producción.

Las herramientas del chat, la analítica y las recomendaciones leen de Moodle con las funciones del punto 1.
También están listas `GET /analytics/courses/:courseId`, `GET …/students/:studentId` y
`POST …/students/:studentId/recommendations`
([analítica](../architecture/analitica.md)).

## 3. Hecho: curso de prueba con datos sintéticos

`infra/moodle/cli/seed_curso_prueba.php` crea el curso `AN-401-PRUEBA`: 12 estudiantes ficticios con nombres
reconocibles, 3 tareas, un foro, un cuestionario, una página y una etiqueta, entregas completas, en borrador, tardías,
sin entrega y pendientes de calificar, notas con perfiles distintos (una oculta), finalización y último acceso
(con inactivos y un estudiante que nunca entró). Detalle en la [guía del entorno local](../desarrollo/entorno-local.md).
Con `--recrear` se borra y se vuelve a crear con plazos relativos a hoy.

## 4. Decisiones

- **Permiso de administrador: hecho** (2026-11-10). La capacidad `local/ai_assistant:administer` existe, `check_access` la
  devuelve como `admin` y protege `/audit` y `/admin/difficulty-rules` ([ADR-020](../architecture/adr/0020-capacidad-administer-y-rutas-de-administracion.md)).
- **Auditoría (CU-07): hecha.** La consulta `GET /audit` y las pantallas «Auditoría» y «Reglas de dificultad» están hechas, de
  punta a punta con un administrador de prueba (`prueba_admin`).
- **Tipos de actividad (D-05): sigue provisional.** `assign`, `forum`, `quiz`, `label` y `page`; se confirma con la institución
  junto con las ponderaciones (D-04). El curso de prueba incluye los cinco.

## 5. Pendiente con la institución

- **D-03:** sílabos reales, anonimizados y con permiso: entre 10 y 20, con mezcla de PDF y DOCX y algunos
  escaneados para probar el OCR. Sin ellos no se puede medir el F1 de la extracción (`pnpm eval:extraction`).
- **D-09 y D-10:** docentes del piloto y calendario, para la evaluación del Sprint 12.

## Qué desbloquea cada cosa

| Si José entrega                    | La línea de IA puede hacer                                                   | Estado    |
| ---------------------------------- | ---------------------------------------------------------------------------- | --------- |
| Funciones de lectura (punto 1)     | Herramientas del chat sobre Moodle real; indicadores y señales de dificultad | Entregado |
| Cambio de contrato (punto 2)       | Que el docente vea nombres y no seudónimos en el chat                        | Entregado |
| Curso de prueba (punto 3)          | Probar de punta a punta y medir RNF-01 a RNF-03                              | Entregado |
| Permiso de administrador (punto 4) | `/admin/difficulty-rules` y `/audit`                                         | Entregado |
| Sílabos reales (punto 5)           | Conjunto de referencia y F1                                                  | Pendiente |

Las medidas de RNF-01 a RNF-03 solo valen con el proveedor de IA real: con `AI_PROVIDER=mock` no se miden.
