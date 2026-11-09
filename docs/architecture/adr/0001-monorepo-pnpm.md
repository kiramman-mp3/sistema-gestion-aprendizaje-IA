# ADR-001: Monorepo con pnpm workspaces

- **Estado:** Aceptada
- **Fecha:** 2026-11-09
- **Sprint:** S0

## Contexto

El sistema tiene un backend NestJS, un worker documental, contratos compartidos (esquema del sílabo, DTOs) y un plugin de Moodle en PHP. Los contratos deben ser los mismos en el backend y en el worker.

## Decisión

Un solo repositorio con `pnpm` workspaces: `apps/*` para aplicaciones, `packages/*` para código compartido y `moodle/` para el plugin PHP, que queda fuera del workspace de Node.

## Alternativas consideradas

| Alternativa            | Por qué no se eligió                                                           |
| ---------------------- | ------------------------------------------------------------------------------ |
| Repositorios separados | Duplica contratos y complica cambios que cruzan backend y worker               |
| npm workspaces         | Viable; se prefirió `pnpm` por instalación más rápida y dependencias estrictas |

## Consecuencias

- Se instala `pnpm` en los equipos de desarrollo y en CI (`packageManager` en `package.json`).
- Un cambio de contrato y sus consumidores van en la misma rama.
