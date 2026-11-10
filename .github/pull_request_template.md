## Qué cambia

<!-- Una o dos frases. Enlaza la tarea del roadmap o el issue: "Sprint 5 · feature/llm-provider-abstraction", "Cierra #12". -->

## Cómo se probó

<!-- Pruebas nuevas o actualizadas y verificaciones manuales (por ejemplo, contra el Moodle local con datos sintéticos). -->

## Lista de verificación

- [ ] La rama sale de `develop` y el PR apunta a `develop`.
- [ ] Commits pequeños con Conventional Commits, sin trailers de coautoría de IA.
- [ ] `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test` y `pnpm build` pasan.
- [ ] Si cambió el plugin: `pnpm check:amd` y `bash infra/scripts/phpcs.sh` pasan, y `version.php` subió si hace falta.
- [ ] Si cambió la API: `docs/api/openapi.yaml` actualizado y `pnpm lint:api` pasa.
- [ ] Si cambió el esquema de Prisma: migración incluida.
- [ ] Documentación actualizada (README, guía local, ADR) si cambian scripts, variables de entorno o decisiones.
- [ ] Solo datos sintéticos; ningún secreto ni dato real de estudiantes.
