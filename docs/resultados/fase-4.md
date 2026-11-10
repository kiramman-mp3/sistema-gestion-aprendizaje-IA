# Resultados de la Fase 4 — Generación y publicación

Sprints 6 y 7 · Cerrada el 2026-11-09 · Hito **H3** alcanzado: estructura publicada en Moodle sin duplicados.

Esta fase cubre la parte del plugin y de la publicación. La extracción con IA (Sprint 5) la construye la
línea de IA; la fase se probó con la extracción de ejemplo de `packages/contracts` y con una extracción
revisada sembrada en la base.

## Entregables

| Entregable                                              | Estado | Evidencia                                                                                                            |
| ------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| Generador de propuestas (RF-07)                         | Hecho  | [Propuestas de curso](../architecture/propuestas.md)                                                                 |
| Validación de ponderaciones y tipos                     | Hecho  | Política provisional hasta cerrar D-04 y D-05                                                                        |
| Máquina de estados de la propuesta (RF-08)              | Hecho  | Las 49 combinaciones de origen y destino probadas                                                                    |
| API de propuestas                                       | Hecho  | `POST`, `GET`, `PATCH` y `approve`; [ADR-014](../architecture/adr/0014-edicion-propuestas-reemplazo-concurrencia.md) |
| Vista previa editable en Moodle                         | Hecho  | `proposal_preview.js`; pruebas en un DOM simulado                                                                    |
| Funciones del plugin para crear secciones y actividades | Hecho  | [Publicación en Moodle](../architecture/publicacion.md); 51 pruebas PHPUnit contra Moodle real                       |
| Publicación idempotente con reanudación (RF-09)         | Hecho  | [ADR-015](../architecture/adr/0015-publicacion-idempotente-identidad-docente.md)                                     |
| Confirmación explícita y resumen de lo publicado        | Hecho  | `publish_panel.js`                                                                                                   |

Verificación de punta a punta con el backend, PostgreSQL, Redis y Moodle 5.1.8 reales: una propuesta de dos
unidades y dos tareas se publicó (4 elementos creados, ocultos, con fecha de entrega solo donde la
extracción la traía); repetir la petición con la misma clave devolvió la misma operación; otra clave sobre la
propuesta publicada respondió `409`.

## Métricas

| Métrica                                         | Resultado                                   | Meta            |
| ----------------------------------------------- | ------------------------------------------- | --------------- |
| Pruebas del backend (Jest)                      | 300 de 300 (6 opcionales contra PostgreSQL) | Todas en verde  |
| Pruebas del JavaScript del plugin (Vitest)      | 132 de 132                                  | Todas en verde  |
| Pruebas del plugin (PHPUnit, Moodle real)       | 51 de 51 (147 aserciones)                   | Todas en verde  |
| Pruebas de contratos y del worker (Vitest)      | 19 y 22                                     | Todas en verde  |
| Cobertura de líneas del backend                 | 94,53 % (ramas 86,28 %)                     | ≥ 70 % (RNF-05) |
| Cobertura de líneas de `src/proposals`          | 95,41 % (ramas 90,37 %)                     | ≥ 70 % (RNF-05) |
| Estándar de código Moodle (`phpcs`)             | 0 errores, 0 advertencias                   | 0               |
| Elementos duplicados al repetir una publicación | 0 en todos los casos probados               | 0 (SEC-04)      |

La cobertura se midió con `pnpm --filter @smart-lms/api test:cov`. Las pruebas contra PostgreSQL real se
ejecutaron aparte con `RUN_DB_TESTS=1` (6 de 6).

## Casos cubiertos

| Caso   | Descripción                                          | Resultado                                                                                       |
| ------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| FUN-05 | Docente aprueba la propuesta                         | `APPROVED` con aprobador y fecha; transiciones inválidas responden `409`                        |
| FUN-06 | Docente publica                                      | Se crean únicamente los elementos aprobados (una actividad quitada antes de aprobar no se crea) |
| SEC-04 | Repetición de una petición de publicación            | Misma clave: misma operación; otra clave: `409`; 3 peticiones simultáneas: una operación        |
| SEC-01 | Acceso a una propuesta o publicación de otro curso   | `404`, sin tocar Moodle                                                                         |
| RF-09  | Caída de Moodle a mitad de la publicación            | Propuesta `FAILED` con el elemento y la causa; al reanudar solo se crean los pendientes         |
| RF-09  | Moodle aplicó la llamada pero se perdió la respuesta | Al reanudar Moodle devuelve lo ya creado; sin duplicados                                        |
| RF-02  | Docente sin permisos de edición en Moodle            | Sin contenido creado; `MOODLE_PERMISSION`                                                       |

## Riesgos detectados

| Riesgo                                                                                         | Estado y mitigación                                                                                         |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| D-04 y D-05 sin cerrar: política de ponderaciones y tipos de actividad son provisionales       | Abierto: se cambian en `DEFAULT_PROPOSAL_POLICY`, `ACTIVITY_TYPE_TO_ITEM_TYPE` y `publisher::MODULES`       |
| Las pruebas PHPUnit del plugin no corren en CI                                                 | Abierto: CI solo ejecuta `phpcs`; se ejecutan en el entorno local. Valorar una tarea con `moodle-plugin-ci` |
| Un error propio de web service no aparece en PHPUnit ni en CLI (faltó cargar `course/lib.php`) | Resuelto; se detectó con la verificación de punta a punta. Mantenerla como paso del cierre de sprint        |
| La vista previa y el panel no se han visto en un navegador contra la API de IA real            | Abierto: dependen de la extracción del Sprint 5; se verificó en un DOM simulado                             |
| Una propuesta publicada es de solo lectura; corregirla exige editar en Moodle                  | Aceptado en el MVP                                                                                          |
| Las actividades se crean ocultas: el docente debe mostrarlas                                   | Aceptado y avisado en la pantalla; valorar un ajuste en el plugin si la institución lo prefiere             |

## Pendiente de la fase

- Manuales de usuario (`docs/user-manual/`) y capítulos de tesis (`docs/thesis/`): Sprint 13.
- Capturas de la vista previa y de la publicación para el README, con el flujo completo en Moodle.
