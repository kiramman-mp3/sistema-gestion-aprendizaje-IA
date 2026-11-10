# ADR-017: Lecturas de Moodle con un contrato de solo ids

- **Estado:** Aceptada
- **Fecha:** 2026-11-10
- **Sprint:** S8

## Contexto

Las herramientas del asistente necesitan leer entregas, pendientes y notas de Moodle. El usuario de integración
solo llamaba a `check_access` y a las funciones de publicar. La [seudonimización](0010-seudonimizacion.md) exige
que el modelo no reciba nombres ni datos personales, y el plugin ya resuelve los nombres con
`get_course_students`.

## Decisión

1. El plugin expone funciones de lectura de solo ids (`local_ai_assistant_list_activities`,
   `list_students`, `get_submissions`, `get_pending_grading`, `get_grades`, `get_completion` y
   `get_last_access`). Todas reciben `userid` (el docente en cuyo nombre se consulta) y `courseid`, y el plugin
   valida los permisos de ese docente en el curso.
2. El contrato de las respuestas vive en `packages/contracts/src/moodle/read.ts` como esquemas Zod
   **estrictos**: un campo de más, como `fullname` o `email`, hace fallar la validación en vez de pasar de largo.
3. Fechas en ISO-8601 UTC y nota ausente como `null`, nunca `0`. Un indicador `truncated` avisa si el plugin
   cortó la lista por volumen, y el asistente marca la respuesta como incompleta.
4. El código de la aplicación depende de la clase abstracta `MoodleRead`, no de cómo se llama a Moodle: las
   pruebas la sustituyen con datos en memoria y `MoodleReadService` es la implementación real.

## Alternativas consideradas

| Alternativa                                        | Por qué no se eligió                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Funciones estándar de Moodle (`mod_assign_*`)      | Devuelven nombres, correos y más datos de los necesarios; habría que filtrarlos en el backend |
| Que el modelo reciba nombres y se filtren al salir | Contradice la minimización de datos de la LOPDP y el ADR-010                                  |
| Esquemas no estrictos                              | Un cambio en el plugin podría filtrar datos personales sin que ninguna prueba falle           |

## Consecuencias

- El plugin debe implementar estas funciones antes de que las herramientas corran contra un Moodle real
  ([pendiente de José](../../equipo/pendiente-de-jose.md)); mientras tanto se prueban con un Moodle simulado.
- Si Moodle devuelve un campo no previsto, la herramienta falla y el asistente lo informa como dato incompleto.
- Cambiar el contrato exige actualizar el esquema primero y avisar a la línea del plugin.
