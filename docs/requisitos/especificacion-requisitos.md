# Especificación de requisitos

Versión 0.1 · Sprint 1 · Estado: **borrador para validar con el tutor y los docentes piloto**.

Este documento numera y precisa los requisitos del
[documento de requisitos](implementacion_lms_inteligente_ia.md) para poder enlazarlos con sprints,
casos de uso y pruebas. Las metas numéricas son propuestas y se ajustan con los datos de las
entrevistas (D-09) y el presupuesto de IA (D-07).

## 1. Actores

| Actor                       | Descripción                                                            | Capacidad Moodle (propuesta)                           |
| --------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| Docente                     | Planifica su curso, consulta información y recibe recomendaciones      | `local/ai_assistant:use`, `local/ai_assistant:publish` |
| Docente sin edición         | Consulta información del curso, sin publicar estructura                | `local/ai_assistant:use`                               |
| Administrador institucional | Configura la integración, umbrales, retención y proveedor de IA        | `moodle/site:config`                                   |
| Estudiante                  | Sin acceso a funciones del asistente en el MVP                         | Ninguna                                                |
| Sistema Moodle              | Fuente de verdad de cursos, usuarios, roles, entregas y calificaciones | —                                                      |
| Proveedor LLM               | Servicio externo de comprensión y generación de lenguaje               | —                                                      |

## 2. Requisitos funcionales

Formato de los criterios: **Dado** (contexto) · **Cuando** (acción) · **Entonces** (resultado esperado).

### RF-01 · Autenticación plugin–backend

El plugin firma un JWT de vida corta por petición y el backend lo valida (ADR-006).

- Dado un JWT válido, cuando el plugin llama al backend, entonces la petición se procesa con el usuario y curso del token.
- Dado un JWT expirado, con firma inválida o con un `jti` ya usado, entonces el backend responde `401` y registra el intento en auditoría.
- La clave de firma no aparece en el HTML, el JavaScript ni los logs.

### RF-02 · Autorización por curso y capacidad

- Dado un docente sin rol en el curso X, cuando consulta cualquier dato del curso X, entonces el backend responde `403`.
- Dado un usuario sin `local/ai_assistant:publish`, cuando intenta publicar una propuesta, entonces el backend responde `403`.
- La comprobación se hace en el servidor en cada petición; la caché de capacidades dura como máximo 5 minutos.

### RF-03 · Carga segura de sílabos

- Se aceptan PDF y DOCX de hasta 10 MB (RNF-04).
- Dado un archivo cuya extensión no coincide con su MIME real (magic bytes), entonces se rechaza con un mensaje claro.
- Dado un archivo detectado como malicioso por el antivirus, entonces se rechaza y se registra en auditoría.
- Se guarda el checksum SHA-256 para detectar recargas del mismo documento.

### RF-04 · Extracción de texto

- Se conserva el número de página de cada fragmento extraído.
- Se detectan encabezados y tablas cuando el formato lo permite.
- Dado un PDF escaneado sin capa de texto, entonces se aplica OCR y la extracción se marca con confianza baja.
- El progreso del trabajo se puede consultar (`GET /syllabi/:id`).

### RF-05 · Extracción estructurada con IA

- La salida cumple el esquema `syllabus-extraction` v1 (`packages/contracts`).
- Dado un sílabo sin fechas o sin ponderaciones, entonces esos campos quedan en `null` y aparecen en `uncertainFields`. Nunca se inventan.
- Las reglas de `findConsistencyIssues` se ejecutan y sus advertencias se muestran al docente.
- El texto del documento se trata como datos: instrucciones dentro del sílabo no cambian el comportamiento del sistema.

### RF-06 · Revisión y versionado de la extracción

- El docente puede editar todos los campos de la extracción.
- Cada guardado crea una versión nueva; las anteriores se conservan.
- Una propuesta queda vinculada a la versión exacta de la extracción que la originó.

### RF-07 · Generación de propuesta

- Cada unidad genera una sección; cada actividad se asigna a un tipo de Moodle según D-05.
- Cada actividad queda vinculada a una unidad y al menos a un resultado de aprendizaje, o se marca para revisión.
- Las fechas solo se asignan si están en la extracción o el docente las confirma.
- Dado que se reprocesa el mismo sílabo (mismo checksum), entonces el sistema avisa y no duplica propuestas sin confirmación.

### RF-08 · Edición y aprobación de propuesta

- Estados: `DRAFT → NEEDS_REVIEW → APPROVED → PUBLISHING → PUBLISHED`, además de `REJECTED` y `FAILED`.
- Dada una transición no permitida (por ejemplo `DRAFT → PUBLISHED`), entonces se rechaza con `409`.
- Se registra quién aprobó y cuándo.

### RF-09 · Publicación idempotente

- Solo se publican propuestas `APPROVED` y tras confirmación explícita.
- Dada una petición de publicación repetida con la misma clave de idempotencia, entonces no se crean elementos duplicados.
- Dado un fallo a mitad de la publicación, entonces la propuesta queda `FAILED` con el detalle por ítem y se puede reanudar desde el último ítem creado.
- Cada elemento creado guarda su ID de Moodle.

### RF-10 · Chat con herramientas

- El modelo solo accede a datos mediante herramientas explícitas y tipadas; no existe una herramienta de SQL libre.
- Las herramientas de escritura requieren confirmación del docente.
- Dada una pregunta ambigua, entonces el asistente pide una sola aclaración concreta.
- Dado que el proveedor LLM no responde, entonces el sistema informa el fallo sin inventar una respuesta.

### RF-11 · Consulta de entregas

- La respuesta incluye actividad, curso, fecha y hora de consulta, criterio aplicado, estudiantes con su estado y enlace a Moodle.
- Se distinguen los estados que devuelve Moodle: sin entrega, borrador, enviada y tardía.
- El resultado coincide con Moodle en el 100 % de las preguntas del conjunto de referencia sobre datos sintéticos.

### RF-12 · Pendientes de calificar

- Lista las entregas enviadas sin calificación, agrupadas por actividad, con enlace a la pantalla de calificación.

### RF-13 · Resumen de calificaciones

- Los promedios se calculan con código determinista según la configuración del libro de calificaciones del curso.
- No se comparan actividades con escalas distintas sin normalizar; si no se puede normalizar, se indica.

### RF-14 · Búsqueda en documentos (RAG)

- Solo se recuperan fragmentos del curso consultado (filtro aplicado antes de la búsqueda).
- Cada respuesta basada en documentos cita documento y página.

### RF-15 · Indicadores del curso

- Indicadores: porcentaje de entregas, actividades pendientes, promedio, evolución, rendimiento por unidad y participación.
- Cada indicador tiene una definición documentada visible para el docente.
- Los valores coinciden al 100 % con una hoja de verificación manual.

### RF-16 · Señales de posible dificultad

- Reglas configurables: actividades obligatorias sin entregar, notas bajo umbral, descenso sostenido y dificultades repetidas en un resultado de aprendizaje.
- Cada señal muestra qué regla se activó y con qué datos.
- La interfaz indica que una señal no es un diagnóstico ni una predicción.

### RF-17 · Evidencias por estudiante

- Solo accesible para usuarios con permiso sobre ese estudiante en ese curso.
- Muestra datos observados separados de cálculos e interpretaciones.

### RF-18 · Recomendaciones pedagógicas

- Incluye evidencias, fortalezas, dificultades, información faltante, estrategias, actividades de refuerzo e indicadores de seguimiento.
- Dada una recomendación con atribuciones personales o diagnósticos, entonces el validador de salida la rechaza y se regenera o se informa el fallo.

### RF-19 · Auditoría

- Se registran: autenticaciones fallidas, accesos denegados, consultas a datos de estudiantes, aprobaciones y publicaciones.
- Los registros no guardan nombres, notas ni texto completo de mensajes.
- Solo el administrador institucional consulta la auditoría completa.

### RF-20 · Seguimiento de recomendaciones

- El docente registra si aplicó una recomendación, qué hizo y el resultado observado.

## 3. Requisitos no funcionales

| ID     | Categoría      | Requisito                                            | Meta propuesta                         | Cómo se mide                        |
| ------ | -------------- | ---------------------------------------------------- | -------------------------------------- | ----------------------------------- |
| RNF-01 | Rendimiento    | Tiempo hasta el primer token del chat                | p95 < 3 s                              | Trazas del backend                  |
| RNF-02 | Rendimiento    | Respuesta completa del chat con una herramienta      | p95 < 10 s                             | Trazas del backend                  |
| RNF-03 | Rendimiento    | Extracción de un sílabo de 20 páginas                | < 2 min                                | Duración del trabajo en la cola     |
| RNF-04 | Seguridad      | Tamaño máximo de archivo                             | 10 MB                                  | Prueba de carga de archivo          |
| RNF-05 | Mantenibilidad | Cobertura de pruebas en módulos de dominio           | ≥ 70 %                                 | Reporte de cobertura en CI          |
| RNF-06 | Seguridad      | Consultas no autorizadas bloqueadas                  | 100 %                                  | Suite de pruebas de autorización    |
| RNF-07 | Costo          | Costo de IA por docente al mes                       | Límite configurable (D-07)             | Registro de tokens por mensaje      |
| RNF-08 | Privacidad     | Retención de documentos, embeddings y conversaciones | Configurable; por defecto a fijar      | Tarea de limpieza y auditoría       |
| RNF-09 | Usabilidad     | Idiomas de la interfaz                               | Español e inglés                       | Cadenas en `lang/es` y `lang/en`    |
| RNF-10 | Accesibilidad  | Componentes propios del plugin                       | WCAG 2.1 AA                            | Revisión con herramienta automática |
| RNF-11 | Disponibilidad | Si el backend no responde, Moodle sigue funcionando  | Sin impacto en Moodle                  | Prueba con el backend detenido      |
| RNF-12 | Portabilidad   | Entorno reproducible                                 | `docker compose up` sin pasos manuales | Instalación limpia en otro equipo   |

## 4. Casos de uso

| CU    | Nombre                          | Actor              | Requisitos                       |
| ----- | ------------------------------- | ------------------ | -------------------------------- |
| CU-01 | Procesar sílabo                 | Docente            | RF-01–RF-06                      |
| CU-02 | Generar estructura académica    | Docente            | RF-07, RF-08                     |
| CU-03 | Publicar estructura             | Docente autorizado | RF-02, RF-09, RF-19              |
| CU-04 | Consultar información del curso | Docente            | RF-10–RF-14                      |
| CU-05 | Obtener recomendaciones         | Docente            | RF-15–RF-18, RF-20               |
| CU-06 | Configurar la integración       | Administrador      | RF-16 (umbrales), RNF-07, RNF-08 |
| CU-07 | Consultar auditoría             | Administrador      | RF-19                            |

CU-06 y CU-07 no aparecen en el documento de requisitos; se añaden porque la configuración de umbrales,
retención y costos, y la consulta de auditoría, necesitan un actor y una pantalla.

### Flujos alternativos relevantes

| CU    | Situación                               | Comportamiento esperado                                   |
| ----- | --------------------------------------- | --------------------------------------------------------- |
| CU-01 | Archivo rechazado                       | Mensaje con el motivo; nada se procesa                    |
| CU-01 | Extracción con muchos campos dudosos    | Se muestra igual, con los campos dudosos resaltados       |
| CU-03 | Fallo parcial al publicar               | Informe de creados y fallidos; opción de reanudar         |
| CU-04 | Pregunta ambigua                        | Una sola pregunta de aclaración                           |
| CU-04 | Pregunta fuera del ámbito del asistente | El asistente lo indica y no responde con datos inventados |
| CU-05 | Datos insuficientes del estudiante      | Se indica qué falta; no se generan recomendaciones vacías |

## 5. Restricciones

- Moodle 5.1 local (D-01, D-02); régimen universitario LOES (D-04).
- No se escribe directamente en la base de datos de Moodle.
- No se usan datos reales de estudiantes en desarrollo; solo datos sintéticos o anonimizados.
- Fuera de alcance: lo listado en la sección 3.2 del documento de requisitos.

## 6. Matriz de trazabilidad

| Requisito | Sprint | Pruebas previstas (ver plan de pruebas)    |
| --------- | ------ | ------------------------------------------ |
| RF-01     | S3     | Unitarias del guard JWT; SEC-01, SEC-03    |
| RF-02     | S3     | SEC-01, SEC-02, SEC-10                     |
| RF-03     | S4     | FUN-01, FUN-02, SEC-05                     |
| RF-04     | S4     | FUN-01, IA-01                              |
| RF-05     | S5     | FUN-03, FUN-04, SEC-06, IA-01, IA-02       |
| RF-06     | S5     | Integración de versiones                   |
| RF-07     | S6     | Unitarias del generador                    |
| RF-08     | S6     | FUN-05, unitarias de la máquina de estados |
| RF-09     | S7     | FUN-06, SEC-04                             |
| RF-10     | S8     | FUN-10, IA-06, IA-07                       |
| RF-11     | S8     | FUN-07, IA-03                              |
| RF-12     | S8     | Integración con Moodle sintético           |
| RF-13     | S8     | FUN-08, IA-04                              |
| RF-14     | S9     | SEC-07, IA-06                              |
| RF-15     | S10    | Hoja de verificación manual                |
| RF-16     | S10    | Unitarias de reglas                        |
| RF-17     | S11    | SEC-02                                     |
| RF-18     | S11    | IA-05, validador de lenguaje               |
| RF-19     | S3     | SEC-09                                     |
| RF-20     | S11    | Integración                                |
