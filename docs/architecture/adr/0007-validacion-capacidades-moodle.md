# ADR-007: Validación de capacidades con una función externa del plugin

- **Estado:** Aceptada (implementada en el Sprint 3)
- **Fecha:** 2026-11-09
- **Sprint:** S0 (implementación en S3)

## Contexto

Conocer la identidad del usuario (ADR-006) no basta: hay que saber su rol y capacidades en el curso. Moodle es quien define los permisos.

## Decisión

Crear la función externa `local_ai_assistant_check_access` que, para un usuario y un curso, devuelve rol y capacidades usando `has_capability`. El backend la consulta y guarda el resultado en una caché de pocos minutos.

## Alternativas consideradas

| Alternativa                   | Por qué no se eligió                                                       |
| ----------------------------- | -------------------------------------------------------------------------- |
| Replicar roles en el backend  | Dos fuentes de verdad que se desincronizan                                 |
| Incluir capacidades en el JWT | Útil como optimización, pero las operaciones sensibles se siguen validando |

## Consecuencias

- Toda operación del backend pasa por un guard de curso y capacidad.
- Los cambios de rol en Moodle tardan como máximo el tiempo de caché en reflejarse.

## Implementación

- La función es `local_ai_assistant_check_access` y exige la capacidad de sistema `local/ai_assistant:checkaccess`, asignada solo al rol de integración.
- Devuelve `courseexists`, `active`, `roles` y `capabilities` (`use`, `publish`, `viewanalytics`).
- El backend guarda la respuesta 120 s en Redis; si Redis falla, consulta Moodle directamente. Si Moodle no responde, el backend devuelve 503.
- Detalle y evidencia: [`docs/architecture/autenticacion-autorizacion.md`](../autenticacion-autorizacion.md).
