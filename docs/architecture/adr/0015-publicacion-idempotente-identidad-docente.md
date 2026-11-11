# ADR-015: Publicación idempotente con la identidad del docente

- **Estado:** Aceptada (implementada en el Sprint 7)
- **Fecha:** 2026-11-09
- **Sprint:** S7

Concreta [ADR-008](0008-creacion-actividades-funcion-externa.md).

## Contexto

Publicar una propuesta aprobada (RF-09) crea secciones y actividades en Moodle, una operación que no se
puede deshacer sin borrar contenido del docente. Hay cuatro riesgos:

- Una petición repetida o una respuesta perdida (timeout) no debe crear elementos duplicados (SEC-04).
- Un fallo a mitad de la publicación deja el curso a medias y debe poder reanudarse.
- El usuario de integración del backend tiene permisos mínimos; no debe poder crear contenido en cualquier
  curso por su cuenta.
- Lo publicado no debe verse todavía por los estudiantes si el docente no lo revisó.

## Decisión

1. **El plugin reconoce cada elemento por su id.** Una tabla propia (`local_ai_assistant_items`) relaciona
   el id del elemento de la propuesta con la sección o actividad creada. Pedir otra vez el mismo elemento
   devuelve el que ya existe (`created: false`). Las actividades llevan además el id en su `idnumber`
   (`ai:<uuid>`), de modo que se reconocen aunque se pierda la fila de la tabla.
2. **El backend publica un elemento a la vez y se detiene en el primer fallo.** Cada elemento guarda su
   estado (`PENDING`, `CREATED`, `FAILED`) y su id de Moodle. La propuesta pasa a `FAILED` y se reanuda con
   una operación nueva, que salta lo ya creado.
3. **La publicación es idempotente en dos niveles.** El backend usa `Idempotency-Key` (índice único en
   `publish_operations`): la misma clave devuelve la misma operación. El plugin usa el id del elemento: aunque
   el backend repita una llamada, no hay duplicados.
4. **Se publica con la identidad y los permisos del docente.** El usuario de integración solo tiene la
   capacidad `local/ai_assistant:createcontent` (contexto de sistema). Cada llamada recibe el docente en cuyo
   nombre se publica y exige que **ese docente** tenga `local/ai_assistant:publish`,
   `moodle/course:manageactivities` (o `course:update` para secciones) y `mod/<tipo>:addinstance` en el
   curso. Las actividades se crean con `create_module()` mientras la sesión actúa como ese docente, y la
   sesión del usuario de integración se restaura al terminar.
5. **Las actividades se crean ocultas.** El docente las revisa en Moodle y las muestra cuando quiere. Los
   cuestionarios se crean vacíos.
6. **Los datos del documento se tratan como texto.** Nombres y descripciones llegan sin limpiar
   (`PARAM_RAW`), porque un `<` en un sílabo no debe hacer fallar toda la publicación; el plugin los limpia
   (nombres) o los escapa (descripciones) antes de guardarlos.

## Alternativas consideradas

| Alternativa                                            | Por qué no se eligió                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Publicar con la identidad del usuario de integración   | Habría que darle permisos de edición en todos los cursos; Moodle no aplicaría los permisos del docente |
| Reintentar solo desde el backend (sin id en el plugin) | Un timeout que sí se aplicó dejaría un duplicado al reintentar                                         |
| Detectar duplicados por nombre                         | Dos actividades pueden llamarse igual; el docente puede renombrarlas                                   |
| Seguir tras el primer fallo y publicar lo que se pueda | Las actividades dependen de su sección; varios puntos de corte son más difíciles de explicar           |
| Crear las actividades visibles                         | Un cuestionario vacío o una tarea sin revisar quedaría a la vista de los estudiantes                   |

## Consecuencias

- El plugin tiene una tabla propia y un paso de actualización (`db/upgrade.php`); al cambiar de versión hay
  que ejecutar `admin/cli/upgrade.php`.
- Si el docente borra en Moodle lo publicado, publicar de nuevo lo recrea.
- Moodle registra como autor de lo creado al docente, no al usuario técnico.
- La fecha de entrega se interpreta como el final del día en la zona horaria del docente.
- Cualquier actividad nueva soportada (D-05) exige añadir su tipo a `MODULES`, sus valores por defecto y
  su prueba.
