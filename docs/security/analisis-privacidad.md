# Análisis de privacidad y protección de datos

Versión 0.1 · Sprint 1 · Estado: **borrador técnico**. No sustituye la revisión jurídica de la
institución. Las referencias a la Ley Orgánica de Protección de Datos Personales (LOPDP) de Ecuador y a
su reglamento deben verificarse con el área legal antes del piloto (D-08).

## 1. Roles en el tratamiento

| Rol                         | Quién                                            | Observación                                  |
| --------------------------- | ------------------------------------------------ | -------------------------------------------- |
| Responsable del tratamiento | La institución educativa                         | Decide fines y medios                        |
| Encargado del tratamiento   | Proveedor LLM y, si aplica, proveedor de hosting | Requiere contrato de encargo con garantías   |
| Titulares                   | Estudiantes y docentes                           | Personas cuyos datos se tratan               |
| Desarrollador del proyecto  | Equipo de titulación                             | Accede solo a datos sintéticos en desarrollo |

## 2. Finalidades

| Finalidad                             | Requisitos   | Base de legitimación a validar                                   |
| ------------------------------------- | ------------ | ---------------------------------------------------------------- |
| Planificar cursos a partir del sílabo | RF-03–RF-09  | Ejecución de la función docente (sin datos de estudiantes)       |
| Consultar entregas y calificaciones   | RF-10–RF-13  | Misión educativa de la institución                               |
| Calcular indicadores y señales        | RF-15, RF-16 | Misión educativa; requiere transparencia hacia estudiantes       |
| Generar recomendaciones pedagógicas   | RF-17, RF-18 | A validar: puede requerir consentimiento o información reforzada |
| Auditoría y seguridad                 | RF-19        | Obligación de seguridad del responsable                          |
| Evaluación de la tesis (piloto)       | S12          | Consentimiento informado de docentes participantes               |

## 3. Inventario de datos

| Dato                                | Origen       | Se guarda en la base auxiliar | Se envía al LLM                          | Retención propuesta              |
| ----------------------------------- | ------------ | ----------------------------- | ---------------------------------------- | -------------------------------- |
| Sílabo (archivo)                    | Docente      | Sí, temporal                  | Texto extraído, sin datos de estudiantes | 30 días tras la revisión         |
| Extracción del sílabo               | IA + docente | Sí                            | Sí                                       | Mientras exista el curso         |
| Fragmentos y embeddings             | Sílabo       | Sí                            | Fragmentos pertinentes                   | Igual que el documento           |
| ID de usuario Moodle                | Moodle       | Sí (referencia)               | No                                       | Según la tabla que lo contiene   |
| Nombre del estudiante               | Moodle       | No                            | No; se seudonimiza (ADR-010)             | No se guarda                     |
| Estados de entrega y calificaciones | Moodle       | Solo agregados en snapshots   | Sí, seudonimizados                       | Snapshots: periodo académico + 1 |
| Mensajes del chat                   | Docente      | Sí, seudonimizados            | Sí                                       | 90 días                          |
| Recomendaciones y seguimiento       | IA + docente | Sí                            | Evidencias seudonimizadas                | Periodo académico + 1            |
| Eventos de auditoría                | Backend      | Sí, sin nombres ni contenido  | No                                       | 1 año                            |

Las retenciones son propuestas para discutir con la institución (RNF-08).

## 4. Riesgos y controles

| Riesgo                                                | Probabilidad     | Impacto | Controles                                                                              |
| ----------------------------------------------------- | ---------------- | ------- | -------------------------------------------------------------------------------------- |
| Acceso de un docente a datos de un curso ajeno        | Media            | Alto    | ADR-006, ADR-007, SEC-01, auditoría                                                    |
| Envío de datos identificables al proveedor LLM        | Alta sin control | Alto    | Seudonimización, minimización por herramienta, SEC-07                                  |
| Transferencia internacional de datos al proveedor LLM | Alta             | Medio   | Elegir proveedor con garantías contractuales y sin uso para entrenamiento (D-07, D-08) |
| Etiquetado injusto de estudiantes por las señales     | Media            | Alto    | Reglas transparentes, sin diagnósticos, revisión docente, RF-16, RF-18                 |
| Decisiones basadas solo en tratamiento automatizado   | Baja             | Alto    | La IA no decide; el docente conserva la decisión (sección 10.3 de los requisitos)      |
| Fuga de secretos o tokens                             | Media            | Alto    | Gestor de secretos, SEC-09, rotación del token de Moodle                               |
| Prompt injection en documentos                        | Media            | Medio   | Texto como datos, herramientas con permisos propios, SEC-06                            |
| Conservación excesiva de conversaciones               | Media            | Medio   | Retención configurable y tarea de limpieza                                             |
| Uso de datos reales en desarrollo                     | Baja             | Alto    | Solo datos sintéticos; regla en el plan de pruebas                                     |

## 5. Derechos de los titulares

El sistema debe permitir a la institución atender solicitudes de:

- **Acceso:** exportar las recomendaciones, señales y snapshots asociados a un `moodle_user_id`.
- **Rectificación:** los datos académicos se corrigen en Moodle; las recomendaciones se pueden descartar.
- **Eliminación:** borrar recomendaciones, seguimientos y snapshots de un estudiante, y conversaciones de un docente.
- **Oposición:** excluir a un estudiante del cálculo de señales y de recomendaciones.
- **No ser objeto de decisiones automatizadas:** el diseño ya lo garantiza; se debe informar en la política.

El plugin implementa el Privacy API de Moodle (`classes/privacy/provider.php`) para declarar los datos
que envía al backend y exportarlos o borrarlos desde las herramientas de privacidad de Moodle.

## 6. Transparencia

- Aviso visible en el plugin indicando que el asistente usa IA, qué datos consulta y que sus sugerencias requieren revisión docente.
- Política de uso de IA para estudiantes, publicada por la institución, que explique los indicadores y las señales.
- Cada respuesta del asistente muestra sus fuentes y la fecha de consulta.

## 7. Evaluación de impacto

Se recomienda realizar una evaluación de impacto antes del piloto con datos reales, porque el sistema:

- Trata datos de rendimiento académico de forma sistemática.
- Usa un proveedor externo de IA, posiblemente fuera de Ecuador.
- Genera perfiles de dificultad académica, aunque no tome decisiones.

Responsable de decidir: la institución (D-08).

## 8. Incidentes

Procedimiento a completar en el Sprint 13:

1. Detección (alertas de auditoría, errores, reportes de usuarios).
2. Contención (revocar el token de Moodle, rotar claves, desactivar la integración).
3. Evaluación del alcance con los registros de auditoría.
4. Notificación a la autoridad y a los titulares según los plazos que establezca la LOPDP y su reglamento.
5. Registro y lecciones aprendidas.

## 9. Pendientes para la institución

- [ ] Confirmar el responsable y la base de legitimación de cada finalidad.
- [ ] Aprobar el proveedor LLM y su contrato de encargo (D-07).
- [ ] Aprobar los plazos de retención.
- [ ] Decidir si se realiza la evaluación de impacto y quién la firma.
- [ ] Aprobar el texto del aviso de uso de IA.
