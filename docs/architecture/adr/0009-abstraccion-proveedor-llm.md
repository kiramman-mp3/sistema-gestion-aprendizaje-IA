# ADR-009: Capa de abstracción del proveedor LLM

- **Estado:** Aceptada
- **Fecha:** 2026-11-09
- **Sprint:** S0

## Contexto

El proveedor de IA aún no está definido (D-07) y el documento de requisitos identifica la dependencia de un proveedor como riesgo.

## Decisión

Todo el código usa una interfaz `LlmProvider` con operaciones de salida estructurada, tool calling, streaming y embeddings. Las salidas estructuradas se validan con Zod. Cada proveedor es un adaptador y las pruebas usan un proveedor simulado.

## Alternativas consideradas

| Alternativa                              | Por qué no se eligió                   |
| ---------------------------------------- | -------------------------------------- |
| Usar el SDK de un proveedor directamente | Acopla el código antes de decidir D-07 |

## Consecuencias

- Se puede desarrollar hasta el Sprint 4 sin proveedor elegido.
- Hay que elegir proveedor antes del Sprint 5.
