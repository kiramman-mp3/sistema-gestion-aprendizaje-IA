# 🎓 LMS Inteligente con Asistente de IA

[![Moodle](https://img.shields.io/badge/Moodle-5.1.8-F98012?style=flat-square&logo=moodle&logoColor=white)](https://moodle.org/)
[![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?style=flat-square&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17%20%2B%20pgvector-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?style=flat-square&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-12-F69220?style=flat-square&logo=pnpm&logoColor=white)](https://pnpm.io/)
[![CI](https://github.com/kiramman-mp3/sistema-gestion-aprendizaje-IA/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/kiramman-mp3/sistema-gestion-aprendizaje-IA/actions/workflows/ci.yml)

**LMS Inteligente con Asistente de IA** es una plataforma de gestión del aprendizaje basada en Moodle,
ampliada con una capa propia de inteligencia artificial que ayuda al docente a planificar cursos a
partir de su sílabo, consultar en lenguaje natural la información real del curso y recibir
recomendaciones pedagógicas basadas en evidencias.

Es un proyecto de desarrollo de software y titulación para una institución de educación superior de
Ecuador. Terminó el **Sprint 4** del [roadmap](docs/ROADMAP.md): sobre la versión `v0.1.0` (hito H1,
plugin, backend y Moodle autenticados), el docente ya sube su sílabo y el sistema extrae su texto con
páginas, encabezados y tablas, con OCR para documentos escaneados. Todo se prueba con datos
sintéticos. La extracción estructurada con IA llega en el Sprint 5.

> [!TIP]
> Para levantar el entorno completo, sigue la [guía del entorno local](docs/desarrollo/entorno-local.md).
> Para revisar solo el código:
>
> ```bash
> git clone https://github.com/kiramman-mp3/sistema-gestion-aprendizaje-IA.git
> cd sistema-gestion-aprendizaje-IA
> pnpm install
> pnpm lint && pnpm typecheck && pnpm test
> ```

---

## 📖 Descripción

### ¿Qué problema resuelve?

Planificar un curso en Moodle a partir de un sílabo y dar seguimiento al rendimiento de los
estudiantes exige mucho trabajo manual: crear secciones y actividades una por una, revisar entregas y
calificaciones en distintas pantallas y detectar a tiempo a quién conviene apoyar.

### ¿Qué hace?

1. El docente carga su sílabo en PDF o DOCX.
2. El sistema extrae unidades, resultados de aprendizaje, actividades, evaluaciones y fechas, y marca lo que no encuentra.
3. El docente revisa y corrige la extracción.
4. El sistema propone la estructura del curso y, tras la aprobación del docente, la publica en Moodle.
5. El docente pregunta en lenguaje natural, por ejemplo "¿quién no entregó la tarea 3?", y recibe datos reales de Moodle con su fuente.
6. El sistema calcula indicadores del curso y señales transparentes de posible dificultad.
7. Para un estudiante, el sistema resume evidencias y sugiere estrategias pedagógicas que el docente decide si aplica.

### ¿Para quién está pensado?

Para docentes universitarios que usan Moodle, y para los administradores institucionales que
gestionan la plataforma.

---

## 🖼️ Capturas

| Página del asistente                                                                                                   | Carga del sílabo                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| <img width="420" src="docs/capturas/asistente-conexion.jpg" alt="Página del asistente en Moodle conectada al backend"> | <img width="420" src="docs/capturas/carga-silabo.jpg" alt="Sílabo escaneado procesado con OCR en la página del asistente"> |
| <sub>El docente del curso ve la conexión con el backend y sus permisos (Moodle local, datos sintéticos).</sub>         | <sub>Un sílabo escaneado sintético se procesó con OCR y quedó marcado para revisión.</sub>                                 |

---

## ✨ Características

Implementado hasta el Sprint 4:

- **Entorno reproducible:** Moodle 5.1.8 con `moodle-docker`, base auxiliar PostgreSQL 17 con `pgvector`, Redis y datos sintéticos deterministas, levantados con dos scripts.
- **Integración con mínimo privilegio:** usuario técnico de Moodle con un rol que solo permite usar REST, autorizado en un único servicio restringido definido por el plugin.
- **Backend con salud verificable:** `GET /api/v1/health` informa el estado de la base de datos, Redis y Moodle.
- **Logs sin secretos:** los tokens, cabeceras de autorización y cuerpos de petición se ocultan en los logs.
- **Autenticación entre el plugin y el backend:** el plugin firma un JWT HS256 de 5 minutos y un solo uso; el backend lo verifica y rechaza reutilizaciones.
- **Permisos de Moodle en cada petición:** el backend pregunta a Moodle qué puede hacer el docente en el curso y bloquea cursos ajenos y estudiantes.
- **Auditoría:** los rechazos de autenticación y de acceso quedan registrados sin tokens ni datos personales.
- **Página del asistente en Moodle:** enlazada desde el curso, comprueba la conexión con el backend y muestra los permisos del docente.
- **Contrato del sílabo:** esquema Zod v1 con reglas de consistencia y exportación a JSON Schema.
- **Carga segura de sílabos:** PDF y DOCX de hasta 10 MB, validados por su contenido real, sin macros, con límite de descompresión y analizados con ClamAV antes de guardarse; un archivo malicioso se rechaza y se audita.
- **Extracción de texto en segundo plano:** un worker aislado, sin acceso a la base de datos, extrae el texto con su página, encabezados y tablas; el backend valida el resultado antes de guardarlo.
- **OCR para sílabos escaneados:** las páginas sin texto pasan por Tesseract en español y el documento se marca con confianza baja.
- **Progreso visible en Moodle:** la página del asistente sube el sílabo, muestra el avance y explica el resultado o el error.
- **Retención de archivos:** el original se borra al vencer su plazo (30 días por defecto) y las cargas que no se pudieron encolar se reintentan solas.

Planificadas para el MVP según el [documento de requisitos](docs/requisitos/implementacion_lms_inteligente_ia.md):

- **Planificación asistida:** convierte el texto del sílabo en una propuesta de secciones y actividades que el docente edita y aprueba antes de publicar.
- **Asistente conversacional:** responde preguntas sobre entregas, pendientes de calificar y notas consultando Moodle mediante herramientas explícitas, nunca con SQL libre.
- **Analítica del rendimiento:** indicadores documentados y cálculos deterministas, sin que el modelo de IA calcule notas.
- **Asistente pedagógico:** recomendaciones basadas en evidencias observables, sin diagnósticos ni decisiones académicas automáticas.

---

## 🛠️ Tecnologías Utilizadas

- **Frontend:** plugin local de Moodle 5.1 (`local_ai_assistant`, PHP 8.3).
- **Backend:** NestJS 11 con TypeScript 6, configuración validada con Zod, logs con `pino`, cliente REST propio para Moodle y cliente propio de clamd.
- **Worker documental:** Node con TypeScript, pdf.js 6 para PDF, fflate y fast-xml-parser para DOCX, Poppler y Tesseract para OCR.
- **Cola de trabajos:** BullMQ 6 sobre Redis, con flujos padre/hijo y planificadores.
- **Base de datos:** PostgreSQL 17 con `pgvector` 0.8.6 mediante Prisma 7 y el adaptador `pg`; Redis 8.8 con `ioredis`.
- **IA:** proveedor LLM por definir (D-07) detrás de la interfaz `LlmProvider`.
- **Contratos:** Zod 4 en `packages/contracts`, con exportación a JSON Schema.
- **Pruebas:** Vitest en `packages/*`, en el worker y en el JavaScript del plugin (con jsdom); Jest y Supertest en el backend; PHPUnit en el plugin.
- **Calidad:** ESLint, Prettier, Redocly CLI (contrato OpenAPI), `phpcs` con `moodle-cs` y GitHub Actions.
- **Infraestructura:** Docker Compose (con ClamAV 1.5 y el worker aislado) y `moodle-docker`.

El estado de cada decisión está en el [registro de ADR](docs/architecture/adr/README.md).

---

## 🏛️ Arquitectura

```mermaid
graph TD
    D[Docente] --> M[Interfaz Moodle]
    M --> P[Plugin local_ai_assistant]
    P -->|JWT de vida corta| B[Backend NestJS]
    B --> A[Orquestador de IA]
    A --> L[Proveedor LLM]
    A --> R[RAG con pgvector]
    B --> AV[ClamAV]
    B --> FS[(Almacén de archivos)]
    B --> Q[Cola BullMQ]
    Q --> DW[Worker documental y OCR]
    DW -->|solo lectura| FS
    B --> T[Herramientas académicas]
    T --> W[Moodle Web Services y funciones del plugin]
    B --> AUX[(PostgreSQL auxiliar)]
    B --> RD[(Redis)]
    B --> AUD[Auditoría]
```

Moodle es la fuente de verdad de los datos académicos. El backend valida permisos y consulta Moodle;
la IA interpreta, consulta herramientas y propone, y el docente conserva la decisión final. Hoy están
construidos el plugin, el backend con autenticación y permisos, la carga con antivirus, la cola y el
worker documental; la IA, la publicación y el RAG llegan en los sprints 5 a 9.

---

## 📁 Estructura del Proyecto

```bash
.
├── .github/                        # CI (workflows/ci.yml) y plantillas de issues y pull requests
├── apps/
│   ├── document-worker/            # Worker documental: PDF, DOCX y OCR (sin acceso a la base)
│   │   ├── src/extract/            # Extractores de PDF, DOCX y OCR
│   │   ├── src/processor.ts        # Procesa un trabajo de la cola document-text
│   │   └── Dockerfile              # Imagen con Poppler y Tesseract en español
│   └── api/                        # Backend NestJS
│       ├── prisma/                 # Esquema y migraciones de la base auxiliar
│       ├── prisma.config.ts        # Configuración de Prisma (lee el .env de la raíz)
│       ├── src/
│       │   ├── config/             # Variables de entorno validadas y logger
│       │   ├── common/filters/     # Formato de error del contrato
│       │   ├── auth/               # JWT del plugin, guards de curso y capacidades, GET /session
│       │   ├── audit/              # Registro de auditoría
│       │   ├── health/             # GET /api/v1/health e indicadores
│       │   ├── database/           # PrismaService
│       │   ├── redis/              # Conexión a Redis
│       │   ├── antivirus/          # Cliente de clamd y servicio de análisis
│       │   ├── storage/            # Almacén de archivos subidos
│       │   ├── syllabi/            # POST y GET /syllabi, encolado y resultados del worker
│       │   │   └── extraction/     # Extracción con IA: prompt, verificación contra el texto, versiones y rutas
│       │   ├── proposals/          # Propuestas de curso: generador, validación, estados y API
│       │   ├── assistant/          # Chat: POST /assistant/chat (SSE), orquestador, herramientas y límites de uso
│       │   ├── analytics/          # Indicadores, señales de dificultad, evidencias del estudiante y GET /analytics
│       │   ├── llm/                # Interfaz del proveedor de IA, límites, consumo y proveedor de demostración
│       │   ├── privacy/            # Seudonimización de estudiantes y datos personales
│       │   ├── recommendations/    # Recomendaciones pedagógicas, seguimiento docente y validador de lenguaje
│       │   ├── queue/              # Nombres de colas y conexión de BullMQ
│       │   ├── maintenance/        # Retención de archivos y conversaciones, y reintento de cargas
│       │   └── integrations/       # Cliente REST de Moodle, lecturas académicas y cuenta de integración
│       ├── test/                   # Pruebas e2e
│       └── Dockerfile              # Imagen del backend
├── packages/
│   └── contracts/                  # Esquema del sílabo v1, métricas de extracción, lecturas de Moodle, contratos de la cola y JSON Schema
├── moodle/local/ai_assistant/      # Plugin de Moodle
│   ├── classes/external/           # get_backend_token (AJAX), check_access, publish_section y publish_module (integración)
│   ├── classes/local/              # Emisor de tokens, publicador de secciones y actividades, observador
│   ├── amd/src/ y amd/build/       # Módulos de la página (carga, editor de la extracción, propuesta, publicación, chat, analítica, relación de actividades) y su build
│   ├── templates/                  # Plantilla Mustache de la página
│   ├── db/                         # Capacidades, servicios web, tabla de mapeo (install.xml, upgrade.php) y eventos
│   └── index.php, lib.php          # Página del asistente y enlace en el curso
├── infra/
│   ├── docker/                     # Init de PostgreSQL e imagen de phpcs
│   ├── moodle/                     # local.yml de moodle-docker, Apache y scripts CLI (integración, seed)
│   ├── amd/                        # Rollup de los módulos AMD y pruebas de su JavaScript (Vitest + jsdom)
│   ├── mocks/                      # API de IA simulada para desarrollar la interfaz (`pnpm mock:ai`)
│   ├── loadtest/                   # Prueba de carga básica (`pnpm loadtest`)
│   ├── monitoring/                 # check-health.sh: salud, contenedores, copias y disco
│   └── scripts/                    # moodle.sh, phpcs.sh, copias, restauración, verificación de punta a punta y medición del F1
├── docs/
│   ├── ROADMAP.md                  # Plan por fases y sprints
│   ├── equipo/                     # Reparto del trabajo entre el equipo
│   ├── desarrollo/                 # Guía del entorno local
│   ├── resultados/                 # Resultados por fase
│   ├── capturas/                   # Capturas de pantalla
│   ├── requisitos/                 # Documento original y especificación numerada (RF/RNF/CU)
│   ├── architecture/               # ADR, decisiones, modelo de datos y comparativa
│   ├── api/openapi.yaml            # Contrato OpenAPI v0 del backend
│   ├── security/                   # Análisis de privacidad (LOPDP), revisión OWASP y seguridad de la IA
│   ├── testing/                    # Plan de pruebas
│   ├── levantamiento/              # Guía de entrevista, catálogo de sílabos, consentimiento
│   └── prototipos/                 # Prototipos de baja fidelidad
├── CONTRIBUTING.md                 # Cómo contribuir: ramas, commits, pruebas y PR
├── CLAUDE.md                       # Reglas de Git y documentación del proyecto
├── docker-compose.yml              # Base auxiliar y Redis; perfiles antivirus, worker y api (desarrollo)
├── docker-compose.prod.yml         # Producción: proxy con TLS, red interna, secretos fuera del repositorio
├── .env.example                    # Variables de entorno de referencia
├── package.json                    # Scripts del workspace
└── pnpm-workspace.yaml             # Paquetes y política de scripts de instalación
```

---

## 💻 Requisitos del Sistema

- Node.js 24 o superior (el repositorio usa la versión de `.nvmrc`).
- pnpm 12.
- Git; en Windows, Git Bash para los scripts de `infra/scripts/`.
- Docker Desktop o Docker Engine con Compose v2, unos 3 GB libres para Moodle y las imágenes, y 1,5 GB de memoria para ClamAV.

En producción se necesitarán además una instancia de Moodle 5.1 accesible por HTTPS, un gestor de
secretos y un proveedor de IA; se definen en el Sprint 13.

---

## ⚙️ Instalación y Configuración

La [guía del entorno local](docs/desarrollo/entorno-local.md) explica cada paso y los problemas
conocidos. En resumen:

1. Clonar el repositorio, instalar dependencias y crear el `.env`.

   ```bash
   git clone https://github.com/kiramman-mp3/sistema-gestion-aprendizaje-IA.git
   cd sistema-gestion-aprendizaje-IA
   pnpm install
   cp .env.example .env
   ```

2. Levantar la base auxiliar, Redis y ClamAV, y aplicar las migraciones.

   ```bash
   docker compose --profile antivirus up -d
   pnpm --filter @smart-lms/api prisma:deploy
   ```

3. Levantar e instalar Moodle con datos sintéticos. `install` imprime el token del usuario de integración: cópialo en `MOODLE_TOKEN`.

   ```bash
   bash infra/scripts/moodle.sh setup
   bash infra/scripts/moodle.sh up
   bash infra/scripts/moodle.sh install
   bash infra/scripts/moodle.sh seed
   ```

4. Arrancar el backend y el worker documental.

   ```bash
   pnpm --filter @smart-lms/api dev
   WORKER_STORAGE_SOURCE=./apps/api/var/storage docker compose --profile worker up -d --build document-worker
   ```

| Variable                               | Uso                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `PORT`                                 | Puerto del backend en el host                                                                   |
| `APP_DB_PORT`                          | Puerto de la base auxiliar en el host (por defecto 5433)                                        |
| `APP_DB_PASSWORD`                      | Contraseña de la base auxiliar                                                                  |
| `DATABASE_URL`                         | Conexión a PostgreSQL                                                                           |
| `REDIS_PORT`                           | Puerto de Redis en el host                                                                      |
| `REDIS_URL`                            | Conexión a Redis                                                                                |
| `MOODLE_BASE_URL`                      | URL de Moodle                                                                                   |
| `MOODLE_TOKEN`                         | Token del usuario de integración de Moodle                                                      |
| `MOODLE_ADMIN_PASSWORD`                | Contraseña del administrador de la instancia local                                              |
| `PLUGIN_JWT_SECRET`                    | Secreto compartido para firmar JWT plugin–backend (≥ 32 caracteres)                             |
| `CORS_ORIGINS`                         | Orígenes del navegador permitidos (el `wwwroot` de Moodle)                                      |
| `STORAGE_DIR`                          | Carpeta de los archivos subidos (relativa a `apps/api`)                                         |
| `SYLLABUS_RETENTION_DAYS`              | Días que se conserva el archivo original (por defecto 30)                                       |
| `RATE_LIMIT_PER_MINUTE`                | Peticiones por usuario y minuto antes de responder 429 (120; 0 lo desactiva)                    |
| `CLAMAV_PORT`                          | Puerto de ClamAV en el host (por defecto 3310)                                                  |
| `CLAMAV_URL`                           | clamd por TCP; obligatoria en producción                                                        |
| `WORKER_STORAGE_SOURCE`                | Carpeta del host que el worker monta en solo lectura                                            |
| `AI_PROVIDER`                          | Proveedor de IA (pendiente, decisión D-07); `mock` es el de demostración, no vale en producción |
| `AI_API_KEY`                           | Clave del proveedor de IA                                                                       |
| `AI_TIMEOUT_MS`                        | Tiempo máximo de una llamada al proveedor (60000)                                               |
| `AI_MAX_INPUT_TOKENS`                  | Tokens estimados de entrada a partir de los cuales no se llama (32000)                          |
| `AI_MAX_OUTPUT_TOKENS`                 | Tope de tokens de salida (8192)                                                                 |
| `PSEUDONYM_SECRET`                     | Clave de los seudónimos de estudiantes (≥ 32 caracteres); obligatoria en producción con IA      |
| `AI_CONVERSATION_RETENTION_DAYS`       | Días que se conserva una conversación con el asistente (90, provisional)                        |
| `AI_DAILY_MESSAGES_PER_TEACHER`        | Mensajes por docente en 24 horas antes de responder 429 (200)                                   |
| `AI_DAILY_TOKENS_PER_TEACHER`          | Tokens por docente en 24 horas antes de responder 429 (500000)                                  |
| `AI_DAILY_RECOMMENDATIONS_PER_TEACHER` | Recomendaciones pedagógicas por docente en 24 horas antes de responder 429 (50)                 |

> [!WARNING]
> Los secretos nunca se guardan en el repositorio. `.env` está en `.gitignore`.

---

## ▶️ Uso y Ejecución

### Desarrollo

| Comando                                          | Qué hace                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `pnpm lint`                                      | ESLint en todo el repositorio                                                  |
| `pnpm lint:api`                                  | Valida `docs/api/openapi.yaml` con Redocly                                     |
| `pnpm format` / `pnpm format:check`              | Formatea o verifica el formato con Prettier                                    |
| `pnpm typecheck`                                 | Revisa tipos en todos los paquetes                                             |
| `pnpm test`                                      | Pruebas de todos los paquetes                                                  |
| `pnpm build`                                     | Compila todos los paquetes                                                     |
| `pnpm --filter @smart-lms/api dev`               | Backend en modo desarrollo con recarga                                         |
| `pnpm --filter @smart-lms/api prisma:migrate`    | Crea y aplica una migración en desarrollo                                      |
| `pnpm --filter @smart-lms/api prisma:deploy`     | Aplica las migraciones pendientes                                              |
| `pnpm --filter @smart-lms/contracts schema:json` | Regenera el JSON Schema del sílabo                                             |
| `pnpm --filter @smart-lms/document-worker test`  | Pruebas del worker documental                                                  |
| `pnpm --filter @smart-lms/plugin-js test`        | Pruebas del JavaScript del plugin (modelo y editor de la extracción)           |
| `docker compose --profile antivirus up -d`       | Levanta ClamAV                                                                 |
| `docker compose --profile worker up -d --build`  | Levanta el worker documental aislado                                           |
| `pnpm build:amd`                                 | Compila los módulos AMD del plugin                                             |
| `pnpm check:amd`                                 | Falla si `amd/build` no corresponde a `amd/src`                                |
| `pnpm mock:ai`                                   | API de IA simulada (puerto 3100) para probar la interfaz sin el LLM            |
| `pnpm loadtest -- --scenario session`            | Prueba de carga básica del backend (también `--scenario chat`)                 |
| `pnpm smoke:publicacion`                         | Verificación de punta a punta de CU-02 y CU-03 con Moodle real                 |
| `pnpm eval:extraction [dir] [--check]`           | Precisión, exhaustividad y F1 de la extracción sobre un conjunto de referencia |
| `bash infra/scripts/moodle.sh <comando>`         | `setup`, `sync`, `up`, `install`, `configure`, `seed`, `down`, `compose`       |
| `bash infra/scripts/phpcs.sh [--fix]`            | Revisa (o corrige) el PHP con el estándar de Moodle                            |

### Producción local

`docker compose --profile api up -d --build` ejecuta el backend, el worker y ClamAV en contenedores, con un volumen compartido para los archivos. Con el Moodle local,
`/health` informa `moodle: down` porque Moodle redirige a `http://localhost:8000`; para desarrollar
contra Moodle, ejecuta el backend en el host.

---

## 🚀 Despliegue

El backend se despliega con `docker-compose.prod.yml`: un proxy Caddy con TLS automático (la única entrada), el
backend, el worker documental, PostgreSQL con pgvector, Redis y ClamAV, con red interna, límites de recursos,
contenedores sin privilegios y secretos en archivos fuera del repositorio. Moodle es el de la institución.

```bash
cp .env.production.example .env.production        # y completar; los secretos van en ${SECRETS_DIR}
COMPOSE="docker compose --env-file .env.production -f docker-compose.prod.yml"
$COMPOSE up -d --build app-db redis clamav && $COMPOSE run --rm migrate && $COMPOSE up -d --build
```

| Variable (`.env.production`) | Qué es                                                                |
| ---------------------------- | --------------------------------------------------------------------- |
| `SECRETS_DIR`                | Carpeta con `api.env`, `worker.env`, `db_password` y `redis_password` |
| `API_DOMAIN`, `ACME_EMAIL`   | Dominio público del backend y correo de Let's Encrypt                 |
| `MOODLE_BASE_URL`            | `wwwroot` de Moodle; también es el único origen CORS permitido        |

Las copias de seguridad cifradas (`infra/scripts/backup.sh`), la prueba de restauración (`restore-test.sh`) y el
monitoreo (`infra/monitoring/check-health.sh`) se programan con cron. Pasos completos, actualización y restauración en el
[manual de instalación y operación](docs/operacion/instalacion-y-operacion.md); qué hacer ante un fallo, en el
[procedimiento de incidentes](docs/operacion/procedimiento-incidentes.md); y para quien enseña, el
[manual del docente](docs/user-manual/manual-docente.md).

---

## 🔌 API

Prefijo `/api/v1`. Todas las rutas salvo `/health` exigen el JWT del plugin. Contrato completo en
[`docs/api/openapi.yaml`](docs/api/openapi.yaml).

| Método | Ruta                                                               | Qué hace                                                                                                              |
| ------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`                                                          | Estado de la base, Redis, Moodle y el antivirus                                                                       |
| GET    | `/session`                                                         | Identidad, roles y capacidades del docente en el curso                                                                |
| POST   | `/syllabi`                                                         | Carga un sílabo (multipart) y encola la extracción de texto                                                           |
| GET    | `/syllabi/:id`                                                     | Estado, progreso, páginas y confianza de la extracción                                                                |
| POST   | `/syllabi/:id/extract`                                             | Inicia o reintenta la extracción con IA (202); el sílabo pasa a `EXTRACTED` o `FAILED`                                |
| GET    | `/syllabi/:id/extraction`                                          | Última versión de la extracción, o la de `?version=`                                                                  |
| PUT    | `/syllabi/:id/extraction`                                          | Guarda la revisión del docente como versión nueva y deja el sílabo en `REVIEWED`                                      |
| POST   | `/proposals`                                                       | Genera la propuesta de curso desde una extracción revisada (`publish`)                                                |
| GET    | `/proposals/:id`                                                   | Propuesta con sus elementos y la revisión (`issues`)                                                                  |
| PATCH  | `/proposals/:id`                                                   | Reemplaza los elementos; una propuesta aprobada vuelve a revisión (`publish`)                                         |
| POST   | `/proposals/:id/approve`                                           | Aprueba una propuesta en revisión y sin errores (`publish`)                                                           |
| POST   | `/proposals/:id/publish`                                           | Publica en Moodle una propuesta aprobada o reanuda una fallida; exige `Idempotency-Key` y `confirm: true` (`publish`) |
| GET    | `/proposals/:id/publish-operations/:operationId`                   | Progreso y resultado de una publicación                                                                               |
| GET    | `/courses/:courseId/activity-mappings`                             | Unidades y resultados del sílabo revisado, y las actividades ya relacionadas                                          |
| PUT    | `/courses/:courseId/activity-mappings/:cmId`                       | Relaciona una actividad con una unidad y sus resultados (`publish`)                                                   |
| DELETE | `/courses/:courseId/activity-mappings/:cmId`                       | Quita la relación de una actividad (`publish`)                                                                        |
| POST   | `/assistant/chat`                                                  | Mensaje al asistente; con `Accept: text/event-stream` responde por SSE (`tool`, `token`, `final`, `error`)            |
| GET    | `/assistant/conversations/:id`                                     | Historial de una conversación propia; una ajena responde 404                                                          |
| GET    | `/analytics/courses/:courseId`                                     | Indicadores del curso y señales de dificultad con su explicación (`viewanalytics`)                                    |
| GET    | `/analytics/courses/:courseId/students/:studentId`                 | Evidencias del estudiante: observado, calculado y desconocido (`viewanalytics`)                                       |
| POST   | `/analytics/courses/:courseId/students/:studentId/recommendations` | Genera una recomendación pedagógica; `422` si faltan datos (`viewanalytics`)                                          |
| POST   | `/recommendations/:id/followups`                                   | Registra el seguimiento docente de una recomendación (`viewanalytics`)                                                |

Las herramientas del chat y la analítica leen de Moodle con funciones que el plugin todavía no tiene: con Moodle real esas rutas responden
`503 MOODLE_UNAVAILABLE` hasta que existan ([pendiente de José](docs/equipo/pendiente-de-jose.md)). Con `AI_PROVIDER=mock` la extracción, el chat
y las recomendaciones responden con datos de demostración.

El flujo de carga y extracción de texto está en [`docs/architecture/procesamiento-silabos.md`](docs/architecture/procesamiento-silabos.md); el de la extracción con IA, en [`docs/architecture/extraccion-ia.md`](docs/architecture/extraccion-ia.md); el del chat, en [`docs/architecture/asistente-chat.md`](docs/architecture/asistente-chat.md); el de la analítica y las recomendaciones, en [`docs/architecture/analitica.md`](docs/architecture/analitica.md); el de propuestas, en [`docs/architecture/propuestas.md`](docs/architecture/propuestas.md); el de publicación, en [`docs/architecture/publicacion.md`](docs/architecture/publicacion.md); las pantallas del chat, la analítica y la relación de actividades, en [`docs/architecture/interfaces-plugin.md`](docs/architecture/interfaces-plugin.md); y lo que espera la interfaz de la línea de IA, en [`docs/equipo/integracion-con-ia.md`](docs/equipo/integracion-con-ia.md).

### Migraciones

| Migración                                       | Cambio                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `20261109163904_init`                           | Esquema inicial de 15 tablas y extensiones `vector` y `pgcrypto` |
| `20261109200000_integration_account_unique_url` | Una cuenta de integración por sitio Moodle                       |
| `20261110090000_document_text`                  | Estado `TEXT_READY` y texto extraído del sílabo                  |

El plugin de Moodle tiene su propia tabla, `local_ai_assistant_items` (relaciona cada elemento publicado con su sección o actividad), creada por `db/install.xml` y `db/upgrade.php`; tras actualizar el plugin se aplica con `admin/cli/upgrade.php`.

---

## 🧩 Decisiones y pendientes

### Decisiones cerradas

| Decisión           | Resultado                                         |
| ------------------ | ------------------------------------------------- |
| Versión de Moodle  | 5.1.8, instancia nueva local con datos sintéticos |
| Régimen académico  | Universitario (LOES)                              |
| Gestor de paquetes | pnpm workspaces                                   |
| ORM                | Prisma 7 con adaptador `pg`                       |

### Por confirmar

- Proveedor de IA y presupuesto (D-07).
- Formatos de sílabo, tipos de actividad y reglamento de ponderaciones (D-03, D-04, D-05).
- Política institucional de datos personales y piloto con docentes (D-08, D-09).

El detalle está en [decisiones del Sprint 0](docs/architecture/decisiones-sprint-0.md).

---

## 🗺️ Roadmap de Funcionalidades

- [x] Repositorio, flujo de ramas y CI base
- [x] Decisiones de arquitectura iniciales
- [x] Especificación de requisitos, modelo de datos, contrato API y prototipos (Sprint 1)
- [x] Esquema v1 del sílabo con reglas de consistencia (Sprint 1)
- [ ] Entrevistas, catálogo de sílabos y validación de prototipos con docentes (Sprint 1)
- [x] Entorno Moodle, plugin base, backend, base auxiliar y cliente de Moodle (Sprint 2)
- [x] Autenticación plugin–backend, autorización, auditoría y página del asistente (Sprint 3)
- [x] Carga segura de sílabos, cola, extracción de texto y OCR (Sprint 4)
- [ ] Extracción estructurada con IA y revisión del docente (Sprint 5; hechos el editor y la API, falta medir el F1 con sílabos reales)
- [x] Propuesta de curso: generador, validación, estados, API y vista previa (Sprint 6)
- [x] Publicación idempotente en Moodle, con confirmación, resumen y reanudación (Sprint 7)
- [ ] Asistente conversacional (Sprints 8–9; hechos el chat, el orquestador, la seudonimización y los límites de uso; faltan las funciones de lectura de Moodle y el RAG)
- [ ] Analítica y asistente pedagógico (Sprints 10–11; hechos el panel del plugin, los indicadores, las señales, las evidencias, las recomendaciones y el seguimiento; faltan los snapshots, las reglas por API y medir la pertinencia con un modelo real)
- [ ] Evaluación con docentes (Sprint 12; hechas la revisión OWASP y la prueba de carga, faltan los casos de IA y el piloto)
- [ ] Despliegue y documentación final (Sprint 13; hechos el entorno de producción, las copias, el monitoreo y los manuales, falta el despliegue real, la tesis y la versión 1.0)

---

## 🤝 Cómo contribuir

El trabajo se organiza por sprints en el [roadmap](docs/ROADMAP.md) y el
[reparto del trabajo](docs/equipo/reparto-trabajo.md) dice qué tiene cada persona. Antes de abrir un
pull request lee [`CONTRIBUTING.md`](CONTRIBUTING.md): ramas desde `develop`, Conventional
Commits, verificaciones locales y documentación al cerrar cada sprint. Las reglas de Git completas
están en [`CLAUDE.md`](CLAUDE.md).

| Persona | Línea de trabajo                                                    |
| ------- | ------------------------------------------------------------------- |
| Pashma  | IA, datos y analítica: LLM, extracción, chat, RAG y recomendaciones |
| José    | Moodle, publicación e interfaz: plugin, propuestas, despliegue      |

---

## 👥 Contribuidores

| Nombre            | Commits |
| ----------------- | ------- |
| kiramman-mp3      | 196     |
| JoseM151          | 118     |
| JuanCarlos        | 75      |
| JuanCarlos Pashma | 2       |

---

## 📚 Fuentes

<details>
<summary>Referencias técnicas</summary>

- [Moodle Developer Documentation](https://moodledev.io/)
- [Moodle Web Services](https://moodledev.io/docs/5.1/apis/subsystems/external)
- [Moodle AI subsystem](https://moodledev.io/docs/5.1/apis/subsystems/ai)
- [moodle-docker](https://github.com/moodlehq/moodle-docker)
- [NestJS Documentation](https://docs.nestjs.com/)
- [Prisma Documentation](https://www.prisma.io/docs)
- [pgvector](https://github.com/pgvector/pgvector)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Autoridad de Protección de Datos Personales de Ecuador](https://www.spdp.gob.ec/)

</details>

---

## ✍️ Autor

kiramman-mp3
