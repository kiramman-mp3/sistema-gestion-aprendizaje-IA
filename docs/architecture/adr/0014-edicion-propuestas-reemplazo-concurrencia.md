# ADR-014: Edición de propuestas por reemplazo y control de concurrencia

- **Estado:** Aceptada (implementada en el Sprint 6)
- **Fecha:** 2026-11-09
- **Sprint:** S6

## Contexto

El docente edita la propuesta de curso en la vista previa del plugin: cambia títulos, ponderaciones y
fechas, agrega y quita actividades, y reordena secciones. La propuesta es un árbol (sección → actividades)
con orden. Hay dos riesgos que RF-08 y RF-09 obligan a cubrir:

- Dos peticiones simultáneas (dos pestañas, un doble clic) no deben aprobar ni editar la misma versión
  dos veces.
- Lo que el docente aprobó debe ser exactamente lo que después se publica.

## Decisión

1. **`PATCH /proposals/:id` reemplaza todos los elementos** por los que envía el cliente, en una
   transacción: borra los anteriores y crea los nuevos. La posición es el orden del arreglo. Un elemento
   nuevo trae un UUID generado por el cliente, que el backend usa como id; así una sección nueva puede
   tener actividades hijas en la misma petición.
2. **Los cambios de estado usan concurrencia optimista.** Cada transición ejecuta
   `UPDATE … WHERE id = ? AND status = <estado leído>`; si no actualiza una fila, otra petición se adelantó
   y la respuesta es `409 PROPOSAL_CHANGED`. Es lo que hace que de tres aprobaciones simultáneas solo una se
   aplique.
3. **Editar una propuesta aprobada la devuelve a `NEEDS_REVIEW`** y borra `approvedBy` y `approvedAt`: la
   aprobación pertenece al contenido aprobado.
4. **Los errores impiden aprobar; las advertencias no.** La revisión (`issues`) se calcula al leer la
   propuesta con funciones puras y la política institucional (`PROPOSAL_POLICY`, provisional hasta D-04 y
   D-05); no se guarda.
5. Solo se edita en `DRAFT`, `NEEDS_REVIEW` y `APPROVED`. Desde `PUBLISHING` los elementos solo cambian por
   la publicación.

## Alternativas consideradas

| Alternativa                                     | Por qué no se eligió                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| PATCH por elemento (crear, editar y borrar)     | Reordenar y mover varias actividades exige muchas peticiones y estados intermedios inconsistentes |
| Fusionar cambios con las ediciones del servidor | Sin edición concurrente real (un docente por curso) no compensa la complejidad                    |
| Bloqueo pesimista (`SELECT … FOR UPDATE`)       | Mantiene la transacción abierta durante la lógica de negocio; el `UPDATE` condicional basta       |
| Guardar `issues` en la base                     | Quedarían desactualizadas al cambiar la política (D-04, D-05); recalcularlas es barato            |

## Consecuencias

- El plugin siempre envía la lista completa; es más simple de razonar y de probar.
- Los ids de elementos nuevos los elige el cliente: el backend rechaza con `409 ITEM_ID_CONFLICT` un id que
  ya pertenece a otra propuesta.
- Como PATCH reemplaza, los campos de publicación (`moodleItemId`, `publishStatus`) no pueden existir en
  una propuesta editable. Es coherente con la regla 5: la publicación empieza en `PUBLISHING`, ya sin edición.
- Al cerrar D-04 y D-05 basta cambiar `PROPOSAL_POLICY` y la tabla de tipos de actividad.
