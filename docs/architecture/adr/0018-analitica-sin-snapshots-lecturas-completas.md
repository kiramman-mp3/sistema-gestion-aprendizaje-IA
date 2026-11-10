# ADR-018: Analítica calculada al pedirla, sin snapshots, y solo con lecturas completas

- **Estado:** Aceptada
- **Fecha:** 2026-11-10
- **Sprint:** S10

## Contexto

El ROADMAP del Sprint 10 prevé una tarea programada que guarde snapshots periódicos de los indicadores (tabla
`analytics_snapshots`) para calcular la evolución. Pero toda lectura de Moodle se hace en nombre de un docente
concreto: el plugin valida los permisos de ese usuario ([ADR-017](0017-lecturas-moodle-solo-ids.md)). Una
tarea programada no tiene un docente con el que leer. Además, la señal de caída sostenida se calcula
directamente con el orden cronológico de las notas, sin necesitar historial de indicadores.

Por otra parte, Moodle recorta las listas largas (`truncated`) y las lecturas pueden fallar. Un porcentaje
calculado sobre datos parciales es un número equivocado que parece correcto.

## Decisión

1. Los indicadores, las señales y las evidencias se calculan al pedirlos, a partir de los datos actuales de
   Moodle y de las reglas de `difficulty_rules`. No se guardan snapshots por ahora.
2. Una lectura que falla o viene recortada deja sus indicadores sin valor (`null`), nunca en cero, y las reglas
   que dependen de ella no generan señales. Solo las lecturas esenciales (actividades y estudiantes) hacen
   fallar la petición con `503 MOODLE_UNAVAILABLE`.
3. Los cálculos son funciones puras (`indicators.ts`, `difficulty-signals.ts`) que reciben un conjunto de datos
   y lo devuelven todo, para poder verificarlos a mano con un curso de ejemplo.

## Alternativas consideradas

| Alternativa                                             | Por qué no se eligió                                                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Snapshots por tarea programada                          | No hay un docente con el que leer de Moodle; guardar de forma oportunista (al pedir) crearía huecos que parecen datos   |
| Calcular con los datos parciales y avisar con una marca | El contrato de `CourseAnalytics` no tiene un indicador de datos incompletos; un guion es honesto con el contrato actual |
| Fallar toda la petición si falta cualquier lectura      | Un docente perdería todo el panel por la falta de, por ejemplo, los accesos                                             |

## Consecuencias

- No hay evolución en el tiempo de los indicadores. Si se necesita, se añade guardando un snapshot cada vez que
  un docente abre el panel, y se acepta que tendrá huecos.
- Cada visita al panel hace varias lecturas a Moodle (una por tarea vencida, hasta 50, más seis fijas). Si el
  volumen lo pide, se añade una caché corta.
- Un curso con más de 500 estudiantes o actividades (el máximo de filas por lectura) no tendrá indicadores
  hasta que el plugin pagine.
