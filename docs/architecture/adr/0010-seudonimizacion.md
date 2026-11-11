# ADR-010: Seudonimización antes de llamar al proveedor LLM

- **Estado:** Aceptada
- **Fecha:** 2026-11-09
- **Sprint:** S0 (implementada en S8)

## Contexto

El chat y el asistente pedagógico tratan datos personales de estudiantes. La LOPDP y la sección 10 del documento de requisitos piden minimizar lo que se envía a proveedores externos.

## Decisión

El backend reemplaza nombres y datos identificables por seudónimos (`Estudiante#NNNNNNNN`) antes de enviar contexto al LLM.

Ajustes de la implementación (Sprint 8):

- El seudónimo se deriva con HMAC-SHA-256 de `PSEUDONYM_SECRET`, el curso y el id de Moodle, no se numera por orden de aparición. Así es el mismo estudiante en todos los turnos de la conversación (el historial guardado ya está seudonimizado) sin guardar una tabla de correspondencia.
- Los nombres nunca llegan al backend: los resuelve el plugin con `get_course_students`. Por eso el backend no «restaura nombres»: devuelve los seudónimos y su id de Moodle en `data.students`, y el plugin los sustituye.
- Del texto libre del docente se quitan correos y números largos (cédula, teléfono). Un seudónimo que ninguna herramienta entregó se reemplaza por `[estudiante no identificado]`.

## Alternativas consideradas

| Alternativa                    | Por qué no se eligió                       |
| ------------------------------ | ------------------------------------------ |
| Enviar nombres reales          | Exposición innecesaria de datos personales |
| No enviar datos de estudiantes | Impide responder las preguntas del docente |

## Consecuencias

- La tabla inversa (seudónimo → id) vive solo en memoria durante la petición; no se guarda ninguna.
- Sin `PSEUDONYM_SECRET` (solo fuera de producción) los seudónimos cambian al reiniciar el servidor.
- El texto libre escrito por estudiantes sigue requiriendo la política de D-08.
