# ADR-002: Backend NestJS con Prisma y PostgreSQL

- **Estado:** Aceptada
- **Fecha:** 2026-11-09
- **Sprint:** S0

## Contexto

El documento de requisitos define NestJS + TypeScript para el backend y PostgreSQL como base auxiliar, con Prisma como ORM si se adapta a la versión del proyecto.

## Decisión

Backend en NestJS + TypeScript, base auxiliar PostgreSQL y Prisma como ORM. Si en el Sprint 2 Prisma no soporta bien `pgvector` (ADR-005), las consultas vectoriales se hacen con SQL parametrizado.

## Alternativas consideradas

| Alternativa       | Por qué no se eligió                            |
| ----------------- | ----------------------------------------------- |
| Express sin marco | Menos estructura para guards, módulos y pruebas |
| TypeORM o Drizzle | Prisma ya está en el documento de requisitos    |

## Consecuencias

- Migraciones versionadas con Prisma.
- Moodle guarda los datos académicos; la base auxiliar solo guarda referencias a sus IDs.
