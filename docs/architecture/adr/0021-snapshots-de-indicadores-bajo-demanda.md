# ADR-021: Snapshots de indicadores bajo demanda, uno por día y docente

- **Estado:** Aceptada. Reemplaza el punto 1 de la decisión del [ADR-018](0018-analitica-sin-snapshots-lecturas-completas.md).
- **Fecha:** 2026-11-10
- **Sprint:** S10

## Contexto

El ADR-018 aplazó los snapshots porque leer Moodle exige un docente y una tarea programada no tiene ninguno. Dejaba
abierta una salida: «guardar un snapshot cada vez que un docente abre el panel, y aceptar que tendrá huecos». Sin
historial no hay evolución de los indicadores (RF-15).

## Decisión

1. Al calcular el panel de un curso se guarda un snapshot (`analytics_snapshots`) como mucho **uno por día (UTC), curso y
   docente**. Un índice único `(cuenta, curso, docente, día)` lo garantiza aunque dos peticiones lleguen juntas.
2. Guarda solo la versión de la fórmula, la cantidad de señales y el valor de cada indicador (o `null`): ni ids de
   estudiantes, ni nombres, ni etiquetas.
3. Un curso sin ningún dato (todos los indicadores `null`) no deja snapshot: no aporta a la evolución.
4. Cada docente ve **solo los suyos** (`taken_by`): con grupos separados, un docente ve a un subconjunto de estudiantes y
   sus valores pueden diferir de los de otro; mezclarlos daría una evolución falsa y mostraría agregados de estudiantes
   que ese docente no puede ver.
5. `GET /analytics/courses/:courseId/history?days=` (1 a 365, 90 por defecto) los devuelve del más antiguo al más reciente;
   el panel del plugin muestra la tabla «Evolución» con dos o más visitas.
6. Se conservan `ANALYTICS_SNAPSHOT_RETENTION_DAYS` días (365, provisional hasta D-08); una tarea diaria (03:20) borra los
   vencidos.
7. Un fallo al guardar el snapshot no interrumpe el panel.

## Consecuencias

- La evolución tiene **huecos**: los días en que el docente no abrió el panel no existen y no se rellenan. El plugin lo
  dice.
- Es «uno por día, curso y docente», no «uno por día y curso»: es la forma de no mezclar vistas con distinto alcance.
- Cambiar la fórmula de un indicador exige subir `SNAPSHOT_FORMULA_VERSION`; los snapshots de otra versión no se
  devuelven.
- El resto del ADR-018 (indicadores sin dato en lugar de cero, lecturas esenciales y cálculos puros) sigue vigente.
