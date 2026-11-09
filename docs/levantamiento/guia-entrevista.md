# Guía de entrevista y medición de línea base

Sprint 1. Instrumento para entrevistar de 2 a 5 docentes y medir cuánto tardan hoy en planificar un
curso en Moodle. Ese tiempo es la línea base del indicador de ahorro de tiempo (sección 14.1 del
documento de requisitos).

## Antes de la entrevista

- Firmar el [consentimiento informado](consentimiento-informado-borrador.md).
- Pedir al docente un sílabo de una asignatura que dicte, sin datos de estudiantes.
- Duración prevista: 45 minutos de entrevista + la sesión de medición.
- Registrar respuestas en `docs/levantamiento/entrevistas/E<n>.md` sin nombres; usar un código (E1, E2…).

## Parte A · Perfil (5 min)

1. ¿Cuántos años lleva enseñando y cuántos usando Moodle?
2. ¿Cuántas asignaturas y estudiantes tiene este periodo?
3. Del 1 al 5, ¿qué tan cómodo se siente configurando cursos en Moodle?

## Parte B · Planificación actual (15 min)

4. Describa paso a paso cómo arma un curso en Moodle al inicio del periodo.
5. ¿Parte del sílabo? ¿En qué formato lo recibe (PDF, DOCX, plantilla institucional)?
6. ¿Qué partes del sílabo pasa a Moodle (unidades, actividades, fechas, ponderaciones)?
7. ¿Qué tipos de actividad usa más (tareas, foros, cuestionarios, otros)?
8. ¿Cómo se estructuran los parciales y sus ponderaciones en su institución? ¿Dónde está el reglamento? (D-04)
9. ¿Qué es lo más tedioso o propenso a errores de ese proceso?
10. ¿Reutiliza cursos de periodos anteriores? ¿Cómo?

## Parte C · Seguimiento del curso (15 min)

11. ¿Cómo sabe quién no entregó una tarea? ¿Cuánto tarda en averiguarlo?
12. ¿Cómo identifica lo que tiene pendiente de calificar?
13. ¿Cómo detecta a un estudiante que está teniendo dificultades? ¿Qué señales mira?
14. Cuando detecta dificultades, ¿qué hace? ¿Registra esas acciones en algún lugar?
15. ¿Qué preguntas le gustaría poder hacer sobre su curso y hoy no puede responder rápido?

## Parte D · Expectativas y límites (10 min)

16. ¿Qué le daría confianza en una respuesta generada por IA sobre su curso?
17. ¿Qué no debería hacer nunca un asistente de IA en su curso?
18. ¿Le preocupa algo sobre los datos de sus estudiantes?
19. Si el sistema propone la estructura del curso, ¿qué revisaría antes de aprobarla?

## Medición de línea base

Protocolo para medir el tiempo de planificación manual:

1. Preparar un curso vacío en el Moodle de desarrollo y el sílabo que trajo el docente.
2. Pedir al docente que cree en Moodle las secciones y actividades del **primer parcial**, como lo haría normalmente.
3. Cronometrar desde que abre el curso hasta que declara terminado; no ayudar durante la tarea.
4. Registrar: minutos, número de secciones y actividades creadas, errores corregidos y comentarios.
5. Repetir con al menos 3 docentes para reportar promedio, mediana y dispersión.

En el Sprint 12 se repite la misma tarea con el sistema, con un sílabo de dificultad equivalente.

### Registro

| Código | Asignatura (genérica) | Minutos | Secciones | Actividades | Errores | Observaciones |
| ------ | --------------------- | ------- | --------- | ----------- | ------- | ------------- |
| E1     |                       |         |           |             |         |               |
| E2     |                       |         |           |             |         |               |
| E3     |                       |         |           |             |         |               |
