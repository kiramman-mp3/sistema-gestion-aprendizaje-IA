# ADR-005: Vectores en PostgreSQL con pgvector

- **Estado:** Propuesta
- **Fecha:** 2026-11-09
- **Sprint:** S0

## Contexto

El RAG (RF-14) necesita guardar embeddings y filtrar por curso, documento y permisos antes de buscar. El documento de requisitos no define dónde se guardan los vectores.

## Decisión

Guardar los embeddings en la misma base auxiliar con la extensión `pgvector`, en la tabla `document_chunks`, y filtrar por curso en la misma consulta.

## Alternativas consideradas

| Alternativa             | Por qué no se eligió                                        |
| ----------------------- | ----------------------------------------------------------- |
| Vector store externo    | Otro servicio que operar y asegurar, y otro lugar con datos |
| Búsqueda solo por texto | Peor recuperación con preguntas en lenguaje natural         |

## Consecuencias

- La imagen de PostgreSQL debe incluir `pgvector`.
- El proveedor de embeddings depende de D-07.
