# Cómo contribuir

Gracias por sumarte al **LMS Inteligente con Asistente de IA**. Esta guía resume cómo se trabaja en el
repositorio. Las reglas completas del flujo de Git están en [`CLAUDE.md`](CLAUDE.md) y valen igual
para personas y para asistentes de código.

## Quién puede contribuir

El código es propietario y todos los derechos están reservados ([`LICENSE`](LICENSE)). Que el repositorio sea público no
concede permiso para usarlo, copiarlo ni modificarlo: solo contribuyen las personas del equipo autorizadas por el titular.
Si quieres proponer un cambio sin ser parte del equipo, abre primero un issue para pedir autorización.

## Antes de empezar

1. Lee el [README](README.md), el [roadmap](docs/ROADMAP.md) y el
   [reparto del trabajo](docs/equipo/reparto-trabajo.md) para saber qué sigue y quién lo tiene.
2. Prepara el entorno con la [guía del entorno local](docs/desarrollo/entorno-local.md).
3. Copia `.env.example` a `.env` y completa los valores. **Nunca subas `.env` ni ningún secreto.**

```bash
git clone https://github.com/kiramman-mp3/sistema-gestion-aprendizaje-IA.git
cd sistema-gestion-aprendizaje-IA
pnpm install
cp .env.example .env
```

## Ramas

```text
main      versiones estables con etiqueta (v0.1.0, v0.2.0, …)
develop   desarrollo actual; rama por defecto
  ├── feature/*   funcionalidades
  ├── fix/*       correcciones
  ├── refactor/*  refactorizaciones
  ├── chore/*     mantenimiento y configuración
  └── docs/*      documentación
```

- Nunca trabajes ni hagas push directo sobre `main`.
- Crea cada rama desde `develop` actualizado, con un nombre en kebab-case. Usa el nombre que aparece en
  el roadmap cuando exista (por ejemplo `feature/proposal-generator`).
- No hagas `push --force` sobre `main` ni `develop`.

```bash
git checkout develop
git pull
git checkout -b feature/nombre-de-la-funcionalidad
```

## Commits

Usa [Conventional Commits](https://www.conventionalcommits.org/) en inglés, con commits pequeños que se
puedan revertir solos: `feat`, `fix`, `refactor`, `style`, `docs`, `test`, `chore`, `perf`, `build`,
`ci`.

```text
feat: add proposal state machine
fix: reject proposals without approved extraction
test: cover invalid proposal transitions
```

- No mezcles en un mismo commit funcionalidad, correcciones, refactorizaciones y estilo.
- Usa tu propia identidad de Git. No añadas trailers `Co-Authored-By` ni líneas que atribuyan
  coautoría a herramientas de IA.
- La documentación va en commits `docs:` separados del código.

## Antes de abrir un pull request

Ejecuta lo mismo que la integración continua:

```bash
pnpm lint
pnpm format:check
pnpm lint:api
pnpm typecheck
pnpm test
pnpm build
pnpm check:amd              # si tocaste el JavaScript del plugin
bash infra/scripts/phpcs.sh # si tocaste el PHP del plugin
```

Si cambiaste el plugin de Moodle, ejecuta también sus pruebas PHPUnit (ver la guía del entorno local)
y sube `$plugin->version` en `moodle/local/ai_assistant/version.php` cuando cambien la base de datos,
los servicios, las capacidades, las cadenas o el JavaScript. Al traer cambios del plugin a tu Moodle local, ejecuta
`upgrade.php` y después `setup_integration.php`: sin el segundo, el rol de integración no recibe las capacidades nuevas
y la publicación, el chat y la analítica fallan con `nopermissions`.

Las verificaciones de punta a punta (`pnpm smoke:silabos`, `smoke:publicacion`, `smoke:asistente` y, con una clave de
Gemini, `smoke:ia`) necesitan el entorno completo levantado; ejecútalas antes de integrar cambios en esos flujos.

## Pull requests

- Apunta el PR a `develop` y completa la plantilla.
- Un PR por tarea del roadmap. Si crece demasiado, divídelo.
- Al menos una revisión de la otra persona del equipo antes de integrar.
- Se integra con **merge commit** (equivale a `git merge --no-ff`), no con squash ni rebase, para
  conservar los commits pequeños. Después se borra la rama.
- `main` solo recibe `develop` al cerrar una fase con su hito, con etiqueta de versión.

## Pruebas y datos

- Cada funcionalidad trae sus pruebas: unitarias, e2e del backend (Jest y Supertest), Vitest en el
  worker y en los contratos, y PHPUnit en el plugin.
- Usa solo datos sintéticos (`infra/moodle/cli/seed.php` y los generadores de `test/support/`). Nunca
  copies datos reales de estudiantes, calificaciones o sílabos con datos personales al repositorio.
- Las métricas que se documentan (cobertura, F1, tiempos) salen de ejecuciones reales, nunca se
  inventan.

## Documentación

Al cerrar un sprint o una fase, en una rama `docs/*`:

- Marca las tareas en `docs/ROADMAP.md` y actualiza la tabla de seguimiento y los desvíos.
- Documenta endpoints en `docs/api/openapi.yaml`, decisiones nuevas como ADR en
  `docs/architecture/adr/` y cambios de seguridad o privacidad en `docs/security/`.
- Actualiza el README si cambian scripts, variables de entorno, endpoints, migraciones o la estructura.

## Seguridad

Si encuentras una vulnerabilidad o un secreto publicado por error, no abras un issue público: avisa
directamente a la persona responsable del repositorio y, si es un secreto, rótalo de inmediato.
