# Guion de capacitación para docentes

Sesión práctica para que un grupo de docentes aprenda a usar el asistente con IA en Moodle. Dura **2 horas** y se hace en
un curso de prueba, nunca con datos reales de estudiantes. Complementa el [manual del docente](manual-docente.md); las capturas
de pantalla se toman al impartirla (ver «Material»).

## Antes de la sesión

| Quién       | Qué prepara                                                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Facilitador | El entorno de pruebas con el curso `AN-401-PRUEBA` (`seed_curso_prueba.php`) y una cuenta por docente (o `prueba_docente`)                           |
| Facilitador | El proveedor de IA acordado. Con el de demostración (`AI_PROVIDER=mock`) las respuestas son de ejemplo y lo avisan; no sirve para evaluar la calidad |
| Facilitador | Un sílabo de práctica (hay 12 ficticios en `tests/fixtures/synthetic-syllabi`) y copias del manual                                                   |
| Docentes    | Traer un sílabo de su propia asignatura, **sin datos de estudiantes**, si la institución lo autoriza                                                 |

> [!IMPORTANT]
> Aclara al inicio: el asistente **propone y el docente decide**; no califica, no da diagnósticos y no publica nada sin
> confirmación. Los nombres de los estudiantes no salen de Moodle.

## Agenda

| Min     | Bloque                     | Actividad                                                                                                                       | Sección del manual |
| ------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 0–10    | Bienvenida y límites       | Qué hace y qué no hace el asistente; privacidad; consentimiento si hay piloto                                                   | 6                  |
| 10–20   | Entrar al asistente        | Abrir el curso, **Más ▸ Asistente IA**, leer los permisos de la conexión                                                        | 1                  |
| 20–50   | Del sílabo a la propuesta  | Subir el sílabo, extraer, **revisar las insignias amarillas**, guardar, generar y aprobar la propuesta                          | 2                  |
| 50–60   | Publicar                   | Publicar en el curso de prueba; ver que las actividades quedan **ocultas**; publicar otra vez y comprobar que no hay duplicados | 2                  |
| 60–70   | Pausa                      |                                                                                                                                 |                    |
| 70–85   | Relacionar actividades     | Relacionar dos actividades con sus unidades; ver cómo cambia el rendimiento por unidad                                          | 3                  |
| 85–105  | Preguntarle al asistente   | Las preguntas de práctica de abajo; abrir **Criterio aplicado**; responder una aclaración                                       | 4                  |
| 105–120 | Panel, evidencias y cierre | Señales, evidencias de un estudiante, recomendación y seguimiento; encuesta de satisfacción (SUS)                               | 5                  |

## Preguntas de práctica (curso `AN-401-PRUEBA`)

1. _¿Qué hay pendiente de calificar?_ — Debe decir 4 entregas (una de la Tarea 2 y tres de la Tarea 3). Pide ver el criterio aplicado.
2. _¿Cómo van las notas?_ — Tres actividades con notas; el cuestionario tiene una nota oculta que **no** debe contarse.
3. _¿Quién no entregó la tarea?_ — Es ambigua: espera **una** pregunta de aclaración; responde «la tarea 3».
4. _¿Qué dice el sílabo sobre la bibliografía?_ — Con un sílabo cargado, debe citar la **página**. Pregunta algo que no esté (por
   ejemplo, sobre becas): debe decir que no lo encontró.
5. En una señal del panel, abrir **Ver evidencias**: separar lo observado, lo calculado y lo que falta.

## Qué debe quedar claro al terminar

- Revisar siempre lo que marca el asistente como dudoso antes de guardar o aprobar.
- Una señal **no es un diagnóstico**: es algo para mirar.
- La respuesta puede estar **incompleta**; el aviso existe para eso, y el **criterio aplicado** permite comprobarla.
- Las actividades publicadas están **ocultas** hasta que el docente las revise y las muestre.
- A quién avisar si algo falla (el administrador del asistente) y qué decir: el código del error que muestra la pantalla.

## Evaluación de la sesión

| Qué se mide                | Cómo                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| Uso autónomo               | Cada docente completa el recorrido sílabo → propuesta aprobada → publicada sin ayuda del facilitador   |
| Comprensión de los límites | Tres preguntas: ¿califica el asistente? ¿qué hacer con una señal? ¿qué significa «incompleta»?         |
| Satisfacción               | Escala SUS (10 ítems) al final; se registra sin nombre                                                 |
| Tiempo                     | Minutos que tomó planificar el curso de práctica, para compararlo con la línea base de las entrevistas |

## Material

- Manual del docente impreso o en pantalla, y el guion de práctica de este documento.
- Capturas de pantalla de cada paso (se toman con el entorno de pruebas y sin datos reales; van en `docs/capturas/`). Ya hay capturas del chat, la analítica, la extracción, la propuesta, los avisos de error y la administración; faltan las de la publicación en Moodle y las de la capacitación misma.
- Lista de asistencia y hoja de la encuesta SUS.

## Pendiente

La capacitación con docentes reales y la evaluación de la sesión dependen de los docentes del piloto y del calendario
(D-09, D-10) y de que exista un proveedor de IA acordado (D-07).
