# Revisión de seguridad: OWASP Top 10

Revisión del código, la configuración y las pruebas contra el OWASP Top 10 (2021) y los riesgos de API que más
aplican. Es la parte del Sprint 12 que se puede hacer sin el proveedor de IA y sin los docentes; los casos de
IA (SEC-06 y SEC-07) y la revisión final con la versión integrada quedan para el cierre del sprint.

Se revisó el estado de `develop` al 2026-11-09. Cada fila indica la evidencia (código o prueba) y, cuando
corresponde, el hallazgo y su estado.

## Resultado

| Resultado                             | Cantidad      |
| ------------------------------------- | ------------- |
| Hallazgos corregidos en esta revisión | 4 (H-1 a H-4) |
| Abiertos de severidad media           | 1 (H-6)       |
| Abiertos de severidad baja            | 2 (H-5, H-7)  |
| Aceptados (no llegan a producción)    | 1 (H-8)       |

## Hallazgos

| #   | Hallazgo                                                                                                   | Gravedad | Estado                                                                                                                               | Categoría |
| --- | ---------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| H-1 | `multer` < 2.5.0 (dependencia de `@nestjs/platform-express`): denegación de servicio (GHSA-q7qp-rjg7-q26m) | Alta     | Corregido                                                                                                                            | A06       |
| H-2 | El backend no limitaba las peticiones por usuario                                                          | Media    | Corregido                                                                                                                            | A04, API4 |
| H-3 | Las respuestas no llevaban cabeceras de seguridad y se anunciaba `X-Powered-By`                            | Baja     | Corregido                                                                                                                            | A05       |
| H-4 | No hay prueba de que `pnpm audit` se ejecute a menudo: una vulnerabilidad nueva pasaría desapercibida      | Media    | Corregido (CI falla con alta o crítica en producción)                                                                                | A06       |
| H-5 | Las imágenes de Docker se fijan por versión, no por digest                                                 | Baja     | Abierto                                                                                                                              | A08       |
| H-6 | El secreto JWT es compartido (HS256) y no hay procedimiento automatizado de rotación                       | Media    | Abierto: se documenta el manual en [instalación y operación](../operacion/instalacion-y-operacion.md); falta decidir la periodicidad | A02       |
| H-7 | Las pruebas PHPUnit del plugin no corren en CI                                                             | Baja     | Abierto                                                                                                                              | A08       |
| H-8 | `pnpm audit` informa 3 avisos (1 baja, 2 moderadas) en herramientas de desarrollo (jest, eslint)           | Baja     | Aceptado: no llegan a producción                                                                                                     | A06       |

## Por categoría

### A01 · Control de acceso roto

| Control                                                                             | Evidencia                                                                                                                          |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Cada petición verifica identidad, curso y capacidad en Moodle                       | `PluginAuthGuard` + `CourseAccessGuard` globales; pruebas e2e de SEC-01 y SEC-02                                                   |
| Un recurso de otro curso responde 404 (sin revelar que existe)                      | `proposals`, `syllabi` y publicación: pruebas "SEC-01" en `proposals.e2e-spec.ts` y `proposals-publish.e2e-spec.ts`                |
| Rutas con `:courseId` exigen que sea el del token                                   | `CourseAccessGuard`; prueba en `mappings.e2e-spec.ts`                                                                              |
| Acciones que cambian algo exigen `publish`                                          | `@RequireCapability("publish")` en crear, editar, aprobar, publicar y relacionar                                                   |
| Las funciones de Moodle comprueban los permisos del **docente**, no del backend     | `publisher.php` (`course_for_teacher`); PHPUnit con un docente sin edición y un usuario ajeno                                      |
| El usuario de integración solo puede lo que dice el servicio                        | `db/services.php`, rol `smartlmsintegration`, token restringido                                                                    |
| Las lecturas de Moodle exigen `readdata` al integrador y `viewanalytics` al docente | `classes/external/read.php` y `reader::authorize()`; `read_test.php` con docente sin permiso y un llamador que no es el integrador |

Pendiente (línea de IA): acceso a conversaciones ajenas (SEC-10) y herramientas del chat por curso.

### A02 · Fallos criptográficos

- JWT HS256 de 300 s con `node:crypto` y comparación en tiempo constante; solo acepta HS256 (`plugin-token.ts`).
- TLS en producción con certificados automáticos y HSTS (`infra/docker/caddy/Caddyfile`).
- Copias de seguridad cifradas con AES-256 (openssl, PBKDF2 de 200 000 iteraciones), con prueba de restauración.
- Secretos fuera del repositorio (`SECRETS_DIR`, archivos de Docker secrets); `.env*` ignorados por git salvo las plantillas.
- Los logs redactan secretos (`logger.ts`); prueba SEC-09 de que ningún token aparece en logs ni en la auditoría.
- H-6: rotación del secreto compartido (ver hallazgos).

### A03 · Inyección

- Una sola consulta cruda (`SELECT 1` en la comprobación de salud); el resto es Prisma, parametrizado.
- Todo cuerpo se valida con Zod (`parseBody`); los parámetros de ruta se validan (UUID, enteros positivos).
- Plugin PHP: parámetros validados por la API de servicios web (`PARAM_*`); texto del documento escapado con `s()` y
  nombres limpiados antes de guardarlos; las funciones rechazan UUID, fechas y tipos de actividad inválidos.
- Plugin JS: **no usa `innerHTML`**; todo se construye con `textContent` y atributos. Pruebas con una respuesta del
  chat que contiene HTML (no se interpreta).
- Prompt injection y documentos con instrucciones (SEC-06): línea de IA.

### A04 · Diseño inseguro

- Publicar exige aprobación previa y `confirm: true` explícito; las actividades se crean ocultas.
- Idempotencia en dos niveles y reanudación sin duplicados (`SEC-04`); estados con transiciones probadas (49).
- Cambios de estado con concurrencia optimista (tres aprobaciones simultáneas: una se aplica).
- H-2: límite de peticiones por usuario y minuto (`RateLimitGuard`, 429 con `Retry-After`, se audita el primer
  rechazo de cada ventana).

### A05 · Configuración de seguridad incorrecta

- H-3: cabeceras `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`, `Referrer-Policy` y
  `Cache-Control: no-store`; se quitó `X-Powered-By` (`hardening.e2e-spec.ts`).
- CORS explícito (`CORS_ORIGINS`), sin cookies. Solo se expone `Retry-After` al navegador, para que el plugin pueda
  decir cuánto esperar tras un 429 (prueba en `cors.e2e-spec.ts`).
- Producción: red interna sin salida para la base, Redis y el worker; sin puertos publicados salvo el proxy; contenedores
  sin privilegios, con límites de memoria y procesos y sistema de archivos de solo lectura donde se puede
  (`docker-compose.prod.yml`). El estado de las dependencias no se publica (`/api/v1/health` responde 404 desde fuera).
- El backend no arranca en producción sin ClamAV (`env.ts`).

### A06 · Componentes vulnerables y desactualizados

- H-1 corregido con una sobrescritura de versión (`pnpm-workspace.yaml`); `pnpm audit --prod` sin vulnerabilidades.
- H-4: el CI ejecuta `pnpm audit --prod --audit-level high`.
- H-8: tres avisos en herramientas de desarrollo.
- Versiones fijadas en `package.json` del backend y del worker; `pnpm install --frozen-lockfile` en CI.

### A07 · Fallos de identificación y autenticación

- Token de un solo uso (`jti` en Redis), `iss`, `aud`, `exp` y vida máxima verificados; tokens inválidos, expirados y
  reutilizados responden 401 (SEC-03). Sin Redis o sin Moodle, el backend falla cerrado (503).
- Los estudiantes no reciben ninguna capacidad del plugin (`db/access.php`).

### A08 · Fallos de integridad de software y datos

- `pnpm check:amd` exige que el JavaScript compilado corresponda al código fuente.
- Archivo del sílabo con comprobación de tipo real (magic bytes), macros, bomba ZIP y antivirus (SEC-05).
- Copias con sumas SHA-256 verificadas antes de restaurar.
- H-5 y H-7: imágenes sin digest y PHPUnit fuera de CI.

### A09 · Fallos de registro y monitoreo

- Auditoría de accesos denegados, cargas, propuestas, publicación, relaciones y límites (`audit_events`), sin
  nombres, notas ni tokens.
- `infra/monitoring/check-health.sh` revisa el backend, los contenedores, la antigüedad de la última copia y el
  disco; el [procedimiento de incidentes](../operacion/procedimiento-incidentes.md) dice qué hacer.
- Sin alertas centralizadas: depende de que la institución programe el script.

### A10 · Falsificación de peticiones del lado del servidor (SSRF)

- El backend solo llama a la URL de Moodle configurada, a Redis, a la base y a ClamAV, todos fijados por entorno; ninguna
  URL llega desde el usuario. El worker documental no tiene salida de red en producción.
- Pendiente (línea de IA): el proveedor de IA y cualquier descarga de documentos deben respetar esta regla.

## Riesgos de API (OWASP API Security)

| Riesgo                                  | Estado                                                                                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API1 Autorización a nivel de objeto     | Recursos acotados por curso en cada consulta; 404 en lugar de 403                                                                                                                                    |
| API2 Autenticación rota                 | Ver A07                                                                                                                                                                                              |
| API3 Exposición excesiva de datos       | Los DTO devuelven solo los campos del contrato; los estudiantes se identifican por id; las lecturas de Moodle devuelven solo ids, sin notas ocultas ([lecturas](../architecture/lecturas-moodle.md)) |
| API4 Consumo no restringido de recursos | Límite por usuario (H-2); cuerpo de 11 MB en el proxy y 10 MB por archivo; límite de IA: línea de IA                                                                                                 |
| API5 Autorización a nivel de función    | `@RequireCapability` por ruta; función de Moodle exige capacidades del docente                                                                                                                       |
| API6 Flujos de negocio sensibles        | Confirmación explícita y aprobación previa para publicar                                                                                                                                             |
| API8 Mala configuración                 | Ver A05                                                                                                                                                                                              |
| API9 Gestión inadecuada del inventario  | Contrato único (`openapi.yaml`) validado con Redocly en CI                                                                                                                                           |

## Prueba de carga

Medición básica en el equipo de desarrollo (Windows, Docker, el backend con `RATE_LIMIT_PER_MINUTE=0`), con
`node infra/loadtest/load.mjs`:

| Escenario                | Simultáneas | Duración | Peticiones | Por segundo | p50   | p95   | p99   | Errores |
| ------------------------ | ----------- | -------- | ---------- | ----------- | ----- | ----- | ----- | ------- |
| `session` (GET /session) | 20          | 15 s     | 18 564     | 1 236       | 14 ms | 20 ms | 24 ms | 0       |
| `session`                | 50          | 10 s     | 15 491     | 1 548       | 32 ms | 43 ms | 58 ms | 0       |

La primera petición tarda unos 4 s (conexión fría con Moodle); después los permisos se sirven de la caché de 120 s.
El escenario `chat` está listo, pero sus números solo son válidos con el proveedor de IA real (RNF-01: primer token
p95 < 3 s; RNF-02: respuesta completa p95 < 10 s; RNF-03: extracción de 20 páginas < 2 min): se miden en el cierre
del Sprint 12 con la integración hecha.

## Qué falta del Sprint 12

- Casos de IA SEC-06 y SEC-07, y la medición de RNF-01 a RNF-03 con el proveedor real.
- Repetir esta revisión sobre la versión integrada y con el piloto (encuesta SUS).
- Decidir la periodicidad de rotación del secreto compartido (H-6).
