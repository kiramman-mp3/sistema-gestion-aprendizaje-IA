# ADR-025: La estructura del curso sigue la organización del sílabo

- **Estado:** Propuesta (el criterio de actividades sugeridas se confirma con D-04 y D-05)
- **Fecha:** 2026-11-11
- **Sprint:** S5 a S7 (corrección tras la primera prueba con un sílabo real)

## Contexto

La primera propuesta generada desde un programa analítico real salió así: cuatro secciones, cada una con una lista plana de
todos sus contenidos mínimos (24 viñetas en la primera) y ninguna tarea. Al revisar la extracción se vio por qué:

- El documento define **tres componentes de evaluación** (aprendizaje en contacto con el docente 40 %, práctico experimental
  30 % y autónomo 30 %) y ninguno es un periodo. El modelo los tomó por tres periodos de calificación, puso las cuatro
  unidades en el primero y dejó vacíos el segundo y el tercero, y no registró ningún instrumento de evaluación.
- Los contenidos mínimos vienen agrupados por **unidades temáticas** dentro de cada unidad curricular; el esquema solo tiene
  una lista de temas por unidad y el modelo los aplanó.
- El documento no lista actividades concretas: solo componentes con sus instrumentos. El generador solo crea actividades
  que la extracción trae, así que no creó ninguna.

Es el mismo problema de convención que la medición con sílabos ficticios ya había señalado: solo 2 de 12 extracciones
usaban un único periodo, y 5 de 12 traían los componentes bien.

## Decisión

1. **Prompt de extracción.** Tres reglas nuevas (8 a 10):
   - los componentes de evaluación con su porcentaje van en `assessmentInstruments` y **no** son periodos;
   - `gradingPeriods` son solo los periodos que el documento nombra; si no hay, un único periodo con el nombre del periodo
     académico, `weight` nulo y todas las unidades dentro (la convención de los sílabos sintéticos);
   - si el documento agrupa los contenidos mínimos bajo un nombre propio, un tema por grupo con el formato
     «Nombre del grupo: contenido; contenido», usando el nombre real; si no hay grupos, un tema por contenido y nunca se
     inventa un nombre de grupo.
2. **Generador de propuestas.** Si **ninguna** unidad trae actividades pero el sílabo sí define componentes de evaluación,
   propone una actividad **sugerida** por componente en cada unidad:
   - un cuestionario vacío para el componente que se rinde con exámenes («contacto», «sumativa», «examen», «prueba»,
     «lección») y una tarea para el resto;
   - el título es «Componente — Unidad» y la descripción empieza con «Sugerida a partir del componente de evaluación
     «…» (40 % de la nota) del sílabo» y avisa que el sílabo no define actividades por unidad;
   - **sin fecha ni ponderación propias** (`null`): el porcentaje del componente solo se cita en la descripción;
   - hereda los resultados de aprendizaje de la unidad y no repite un componente que el documento liste dos veces;
   - si alguna unidad trae actividades, el sílabo las define y no se sugiere nada.
3. La regla se puede apagar con `ProposalPolicy.deriveActivitiesFromInstruments` (D-05) sin tocar el generador.

La regla de «no inventar» se mantiene para fechas, ponderaciones y actividades que el sílabo sí lista. La excepción es la del
punto 2, visible en la descripción y editable en la propuesta antes de aprobar.

## Alternativas consideradas

| Alternativa                                                      | Por qué no se eligió                                                                                                               |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Ampliar el esquema con unidades temáticas anidadas (esquema 1.1) | Cambia el contrato, el editor, el generador y las pruebas; con el texto del tema («Grupo: a; b») se obtiene lo esencial sin migrar |
| Subsecciones de Moodle 5 para las unidades temáticas             | Habría que crear módulos de otro tipo y probar su publicación; queda como mejora si el piloto lo pide                              |
| Repartir el porcentaje de cada componente entre las unidades     | Es una ponderación inventada: depende del criterio del docente y sumaría decimales (13,33 %)                                       |
| Dejar las secciones sin actividades                              | No refleja que el sílabo evalúa por componentes y obliga al docente a crear todas las tareas a mano                                |

## Consecuencias

- Con los 12 sílabos ficticios y Gemini: un solo periodo sin ponderación pasó de 2/12 a **12/12**, y los componentes de
  evaluación coinciden con lo esperado en 10/12 (los dos restantes son errores de OCR en el nombre, «AUTÓNONO»; el
  porcentaje es correcto). El F1 de unidades y resultados de aprendizaje se mantiene en 100 %. Son cifras sintéticas.
- Un sílabo ya extraído **no cambia**: la extracción guardada es la de antes. Hay que subirlo de nuevo para que se aplique.
- Con tres componentes y cuatro unidades salen 12 actividades por revisar. Es más trabajo de borrado si el docente no las
  quiere; el piloto debe valorar si el valor por defecto es el correcto (D-05).
- Al unir los contenidos de un grupo en un solo tema, la descripción de la sección tiene una viñeta por grupo en lugar de una por
  contenido; con texto aplanado el modelo a veces no inserta los separadores («;»).
