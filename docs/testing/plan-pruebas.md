# Plan de pruebas

Versión 0.1 · Sprint 1. Desarrolla la sección 13 del
[documento de requisitos](../requisitos/implementacion_lms_inteligente_ia.md) y se enlaza con la
[especificación de requisitos](../requisitos/especificacion-requisitos.md).

## 1. Niveles de prueba

| Nivel         | Herramienta                                           | Alcance                                                | Cuándo                    |
| ------------- | ----------------------------------------------------- | ------------------------------------------------------ | ------------------------- |
| Unitarias     | Vitest (`packages/*`), Jest (`apps/api`)              | Esquemas, reglas, cálculos, máquina de estados, guards | Cada historia, en CI      |
| Integración   | Jest + Supertest, Moodle sintético                    | API con base auxiliar, Redis y Moodle en Docker        | Cada historia de API      |
| Plugin        | PHPUnit y herramientas de Moodle                      | Funciones externas, capacidades, privacidad            | Desde S2                  |
| End-to-end    | Por definir en S12 (Playwright o Behat)               | CU-01 a CU-05 desde la interfaz de Moodle              | S12                       |
| Seguridad     | Pruebas automatizadas + revisión OWASP                | Casos SEC-xx                                           | Desde S3; completa en S12 |
| Calidad de IA | Scripts de evaluación sobre el conjunto de referencia | Métricas IA-xx                                         | S5, S9, S11 y S12         |
| Usabilidad    | SUS + entrevistas                                     | Docentes piloto                                        | S12                       |

## 2. Casos funcionales

| ID     | Caso                          | Resultado esperado                                         | Requisito    |
| ------ | ----------------------------- | ---------------------------------------------------------- | ------------ |
| FUN-01 | Cargar PDF válido             | El archivo se procesa y se obtiene texto con páginas       | RF-03, RF-04 |
| FUN-02 | Cargar archivo no permitido   | Se rechaza con mensaje claro                               | RF-03        |
| FUN-03 | Sílabo sin fechas             | Las fechas quedan `null` y en `uncertainFields`            | RF-05        |
| FUN-04 | Sílabo con tres unidades      | Se detectan las tres o se informa la incertidumbre         | RF-05        |
| FUN-05 | Docente aprueba propuesta     | La propuesta pasa a `APPROVED` con aprobador y fecha       | RF-08        |
| FUN-06 | Docente publica               | Se crean únicamente los elementos aprobados                | RF-09        |
| FUN-07 | Pregunta por entregas         | Estados reales de Moodle, con criterio y fecha de consulta | RF-11        |
| FUN-08 | Pregunta por notas            | Cálculo según reglas documentadas del curso                | RF-13        |
| FUN-09 | Consulta de otro curso        | Se deniega sin permiso                                     | RF-02        |
| FUN-10 | Proveedor de IA no disponible | El sistema informa el fallo sin inventar respuesta         | RF-10        |

## 3. Casos de seguridad

| ID     | Caso                                                | Resultado esperado                                        | Requisito    |
| ------ | --------------------------------------------------- | --------------------------------------------------------- | ------------ |
| SEC-01 | Docente consulta un curso ajeno                     | `403` y registro en auditoría                             | RF-02        |
| SEC-02 | Estudiante usa herramientas del docente             | `403`                                                     | RF-02, RF-17 |
| SEC-03 | Petición con token inválido, expirado o reutilizado | `401`                                                     | RF-01        |
| SEC-04 | Repetición de una petición de publicación           | Sin elementos duplicados                                  | RF-09        |
| SEC-05 | Archivo con extensión falsa                         | Rechazo por MIME real                                     | RF-03        |
| SEC-06 | Documento con instrucciones maliciosas              | Las instrucciones no alteran el comportamiento            | RF-05, RF-14 |
| SEC-07 | Intento de obtener datos personales no necesarios   | Las herramientas no devuelven más datos de los necesarios | RF-10, RF-14 |
| SEC-08 | Inyección en parámetros y filtros                   | Validación de DTO rechaza la entrada                      | Todos        |
| SEC-09 | Fuga de secretos en logs                            | Ningún token, clave ni JWT aparece en logs                | RF-19        |
| SEC-10 | Acceso a la conversación de otro usuario            | `404` (no se revela su existencia)                        | RF-02        |

## 4. Métricas de calidad de IA

| ID    | Métrica                                       | Meta propuesta | Requisito    |
| ----- | --------------------------------------------- | -------------- | ------------ |
| IA-01 | F1 de extracción de unidades                  | ≥ 0.85         | RF-05        |
| IA-02 | F1 de extracción de resultados de aprendizaje | ≥ 0.80         | RF-05        |
| IA-03 | Exactitud de identificación de entregas       | ≥ 95 %         | RF-11        |
| IA-04 | Exactitud de cálculos académicos              | 100 %          | RF-13        |
| IA-05 | Recomendaciones calificadas como pertinentes  | ≥ 70 %         | RF-18        |
| IA-06 | Respuestas sin evidencia                      | ≤ 5 %          | RF-10, RF-14 |
| IA-07 | Abstención correcta cuando faltan datos       | ≥ 90 %         | RF-10        |

Fórmulas (sección 14.2 del documento de requisitos): `Precisión = VP / (VP + FP)`,
`Exhaustividad = VP / (VP + FN)`, `F1 = 2 · P · E / (P + E)`.

Para IA-01 e IA-02, un elemento extraído cuenta como verdadero positivo si coincide con uno del
conjunto de referencia según un criterio definido antes de medir (título normalizado o revisión de un
docente). El criterio se documenta junto a los resultados. El medidor es `pnpm eval:extraction` y su criterio
está en [extracción con IA](../architecture/extraccion-ia.md#medición-de-calidad-ia-01-e-ia-02).

## 5. Conjunto de referencia

Se guarda en `tests/fixtures/` y no contiene datos personales reales.

| Conjunto            | Contenido                                                                                                                                                                                                   | Responsable           | Sprint |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------ |
| Sílabos             | 10–20 sílabos anonimizados con su extracción esperada (JSON v1)                                                                                                                                             | Docentes + desarrollo | S1–S4  |
| Preguntas del chat  | 50+ preguntas con respuesta esperada sobre el Moodle sintético                                                                                                                                              | Desarrollo + docentes | S8     |
| Preguntas ambiguas  | 15+ preguntas que deben producir una aclaración o abstención                                                                                                                                                | Desarrollo            | S8     |
| Documentos hostiles | Sílabos con instrucciones maliciosas para SEC-06                                                                                                                                                            | Desarrollo            | S5     |
| Sílabos sintéticos  | 12 programas analíticos ficticios (8 PDF, 2 DOCX, 2 escaneados) con su extracción esperada, creados a partir de la **estructura** de un programa analítico real; **no valen para las métricas de la tesis** | Desarrollo            | S12    |
| Casos de estudiante | 10+ perfiles sintéticos con recomendaciones evaluadas por docentes                                                                                                                                          | Docentes              | S11    |

Los casos SEC-06, SEC-07 y SEC-10 sobre el chat y la extracción están automatizados en
`apps/api/src/assistant/chat-attacks.spec.ts` y `chat.service.spec.ts`, con un modelo simulado que obedece al
atacante; se describen en [seguridad de la IA](../security/seguridad-ia.md). Falta repetirlos con el proveedor real.

### Medición con los sílabos sintéticos

`pnpm eval:text` (y `pnpm eval:text:docker`, con OCR) mide qué parte de la extracción esperada llega al texto que extrae el
worker documental, sin ningún modelo de IA: datos del curso, unidades, temas, resultados de aprendizaje, porcentajes de
evaluación, metodologías, fechas y bibliografía. Resultado del 2026-11-10: **99,6 %** (446 de 448): 100 % en PDF y DOCX y
97,3 % en los dos escaneados, donde el OCR leyó mal el porcentaje del aprendizaje autónomo en ambos. Por eso el sistema marca
con «confianza baja» el texto de OCR para que el docente lo revise. `pnpm smoke:silabos` repite la carga, el antivirus
(ClamAV), el worker, la extracción con el proveedor de demostración y el rechazo de archivos inválidos. El F1 de la
extracción estructurada (IA-01, IA-02) sigue esperando los sílabos reales y un proveedor real.

## 6. Datos de prueba

- Moodle sintético generado por script (`chore/moodle-seed`, S2): cursos, docentes, estudiantes, tareas con todos los estados de entrega y calificaciones con distintas escalas.
- Curso de prueba `AN-401-PRUEBA` (`seed_curso_prueba.php`) y usuarios de prueba (`seed_docentes_prueba.php`): actividades de cinco tipos, notas (una oculta), finalización, accesos, dos docentes, un tutor, un docente ajeno y un administrador.
- Ningún entorno de desarrollo usa datos reales de estudiantes.
- Las pruebas que llaman al LLM real se ejecutan aparte de CI y registran modelo, versión del prompt y fecha.

## 7. Criterios de salida de la evaluación (S12)

- Todos los casos FUN y SEC pasan.
- Las métricas IA-xx se reportan con su valor real, cumplan o no la meta.
- Ahorro de tiempo reportado con promedio, mediana y dispersión.
- SUS con al menos 5 respuestas, o se informa el tamaño real de la muestra.
