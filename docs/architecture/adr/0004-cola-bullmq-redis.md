# ADR-004: Cola de trabajos con BullMQ y Redis

- **Estado:** Propuesta
- **Fecha:** 2026-11-09
- **Sprint:** S0

## Contexto

La extracción de sílabos y la publicación en Moodle son operaciones largas que necesitan progreso, reintentos y reanudación tras fallos parciales (RF-04, RF-05, RF-09).

## Decisión

Usar BullMQ con Redis para los trabajos asíncronos. El estado de negocio (documento, propuesta) se guarda en PostgreSQL; la cola solo coordina la ejecución.

## Alternativas consideradas

| Alternativa                     | Por qué no se eligió                                  |
| ------------------------------- | ----------------------------------------------------- |
| Tabla de trabajos en PostgreSQL | Hay que implementar bloqueo, reintentos y prioridades |
| Procesamiento síncrono          | Excede los tiempos de respuesta HTTP                  |

## Consecuencias

- Redis se añade al Docker Compose.
- Los trabajos deben ser idempotentes porque pueden ejecutarse más de una vez.
