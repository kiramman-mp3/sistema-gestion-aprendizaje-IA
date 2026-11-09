# ADR-010: Seudonimización antes de llamar al proveedor LLM

- **Estado:** Propuesta
- **Fecha:** 2026-11-09
- **Sprint:** S0 (implementación en S8)

## Contexto

El chat y el asistente pedagógico tratan datos personales de estudiantes. La LOPDP y la sección 10 del documento de requisitos piden minimizar lo que se envía a proveedores externos.

## Decisión

El backend reemplaza nombres y datos identificables por seudónimos (`Estudiante#<n>`) antes de enviar contexto al LLM, y restaura los nombres en la respuesta que ve el docente.

## Alternativas consideradas

| Alternativa                    | Por qué no se eligió                       |
| ------------------------------ | ------------------------------------------ |
| Enviar nombres reales          | Exposición innecesaria de datos personales |
| No enviar datos de estudiantes | Impide responder las preguntas del docente |

## Consecuencias

- La tabla de correspondencia vive solo en memoria durante la petición.
- El texto libre escrito por estudiantes sigue requiriendo la política de D-08.
