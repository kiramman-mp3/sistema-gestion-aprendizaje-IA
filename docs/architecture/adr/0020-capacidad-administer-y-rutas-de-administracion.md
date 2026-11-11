# ADR-020: Capacidad `administer` y rutas de administración institucional

- **Estado:** Aceptada
- **Fecha:** 2026-11-10
- **Sprint:** S10 y S12

## Contexto

El token del plugin solo traía tres capacidades (`use`, `publish`, `viewanalytics`). Las rutas de administración
(`/audit`, CU-07; `/admin/difficulty-rules`, CU-06) necesitaban distinguir a quien administra el asistente de un
docente, y la auditoría completa solo debe consultarla el administrador institucional (RF-19).

## Decisión

1. **Capacidad `local/ai_assistant:administer`**, de contexto de sistema y con el arquetipo `manager` (no la reciben
   docentes ni estudiantes). Como el backend la consulta en el curso del token, un rol asignado en el sistema la tiene en
   todos los cursos. `check_access` la devuelve como `capabilities.admin`; un Moodle con una versión anterior del plugin
   que no la informa se toma como «no administra».
2. **`@RequireCapability("admin")`** protege las rutas (`CourseAccessGuard` ya exige además `use` en el curso del token,
   que el rol de gestión tiene por arquetipo).
3. **`GET /audit`**: filtros por curso, actor, acción (exacta o dominio terminado en punto), resultado y fechas;
   paginación por cursor (`createdAt|id`, estable aunque haya eventos con la misma fecha); hasta 200 por página. Consultarla
   deja el evento `audit.query` con cantidades, sin el contenido.
4. **`GET /admin/difficulty-rules[?courseId]`, `PUT` y `DELETE /admin/difficulty-rules/:rule`**: ven, guardan y quitan las
   reglas de las señales de dificultad de la institución (`courseId: null`) o de un curso, que reemplaza a la institucional.
   Los parámetros se validan con el esquema estricto de cada regla (400 con `details`); cada cambio se audita
   (`rules.update`, `rules.reset`) con el alcance y sin los parámetros.
5. **Pantalla del plugin** («Administración»: auditoría y reglas), visible solo con `capabilities.admin`.
6. La auditoría de un rechazo por tope diario de uso (`assistant.quota_exceeded`) alimenta las alertas de consumo.

## Alternativas consideradas

| Alternativa                                 | Por qué no se eligió                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Reutilizar `publish` o `viewanalytics`      | Un docente con edición podría leer la auditoría de todo el sitio                                    |
| Un rol de administración propio del backend | Duplicaría los roles que Moodle ya gobierna; ADR-007 dice que Moodle es la única fuente de permisos |
| Capacidad de contexto de curso              | Obligaría a asignar el rol curso por curso; la institución administra el asistente para todos       |

## Consecuencias

- La institución asigna el rol de gestión a quien deba administrar. Para pruebas hay un usuario `prueba_admin`
  (`seed_docentes_prueba.php`).
- Con un solo sitio Moodle por despliegue, la consulta de auditoría no filtra por cuenta de integración.
