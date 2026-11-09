# ADR-012: Backend de IA propio frente al subsistema de IA de Moodle

- **Estado:** Propuesta
- **Fecha:** 2026-11-09
- **Sprint:** S0 (evaluar en S1)

## Contexto

Moodle incluye desde la versión 4.5 un subsistema de IA con proveedores y acciones. El documento de requisitos lo cita, pero propone un backend propio.

## Decisión

Usar un backend propio para orquestación, tool calling, RAG y analítica, que el subsistema de Moodle no cubre. En el Sprint 1 se documenta la comparación y si conviene reutilizar su configuración de proveedores.

## Alternativas consideradas

| Alternativa                  | Por qué no se eligió                                                     |
| ---------------------------- | ------------------------------------------------------------------------ |
| Solo el subsistema de Moodle | Acciones limitadas; sin tool calling sobre datos del curso ni RAG propio |

## Consecuencias

- El backend es la contribución principal del proyecto y de la tesis.
- La comparación queda como entregable del Sprint 1.
