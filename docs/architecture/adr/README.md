# Registro de decisiones de arquitectura (ADR)

Cada decisión de arquitectura se registra en un archivo `NNNN-titulo.md` a partir de
[`0000-plantilla.md`](0000-plantilla.md). Una decisión aceptada no se edita: si cambia, se crea un ADR
nuevo y el anterior pasa a "Reemplazada por ADR-NNN".

| ADR                                                           | Decisión                                                                     | Estado                 |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------- |
| [ADR-001](0001-monorepo-pnpm.md)                              | Monorepo con pnpm workspaces                                                 | Aceptada               |
| [ADR-002](0002-backend-nestjs-prisma-postgresql.md)           | Backend NestJS con Prisma y PostgreSQL                                       | Aceptada               |
| [ADR-003](0003-worker-documental-typescript.md)               | Worker documental en TypeScript                                              | Aceptada (provisional) |
| [ADR-004](0004-cola-bullmq-redis.md)                          | Cola de trabajos con BullMQ y Redis                                          | Aceptada               |
| [ADR-005](0005-vectores-pgvector.md)                          | Vectores en PostgreSQL con pgvector                                          | Propuesta              |
| [ADR-006](0006-jwt-plugin-backend.md)                         | JWT de vida corta entre el plugin y el backend                               | Aceptada               |
| [ADR-007](0007-validacion-capacidades-moodle.md)              | Validación de capacidades con función externa                                | Aceptada               |
| [ADR-008](0008-creacion-actividades-funcion-externa.md)       | Creación de actividades con funciones externas                               | Aceptada               |
| [ADR-009](0009-abstraccion-proveedor-llm.md)                  | Capa de abstracción del proveedor LLM                                        | Aceptada               |
| [ADR-010](0010-seudonimizacion.md)                            | Seudonimización antes de llamar al LLM                                       | Aceptada               |
| [ADR-011](0011-entorno-moodle-docker.md)                      | Entorno Moodle de desarrollo con moodle-docker                               | Aceptada               |
| [ADR-012](0012-subsistema-ia-moodle.md)                       | Backend de IA propio frente al subsistema de Moodle                          | Propuesta              |
| [ADR-013](0013-worker-sin-base-de-datos.md)                   | Worker documental sin acceso a la base de datos                              | Aceptada               |
| [ADR-014](0014-edicion-propuestas-reemplazo-concurrencia.md)  | Edición de propuestas por reemplazo y concurrencia optimista                 | Aceptada               |
| [ADR-015](0015-publicacion-idempotente-identidad-docente.md)  | Publicación idempotente con la identidad del docente                         | Aceptada               |
| [ADR-016](0016-extraccion-ia-versiones-inmutables.md)         | Extracción con IA en el proceso de la API, con versiones inmutables          | Aceptada               |
| [ADR-017](0017-lecturas-moodle-solo-ids.md)                   | Lecturas de Moodle con un contrato de solo ids                               | Aceptada               |
| [ADR-018](0018-analitica-sin-snapshots-lecturas-completas.md) | Analítica calculada al pedirla, sin snapshots, y solo con lecturas completas | Aceptada               |

Las decisiones en estado "Propuesta" se confirman o se reemplazan durante el Sprint 1 o en el sprint
indicado en cada ADR.
