# Manual del administrador

Cómo administrar el asistente docente con IA dentro de Moodle: quién puede hacerlo, cómo consultar la auditoría y cómo
configurar las reglas de las señales de dificultad. Está escrito para quien gestiona el asistente en la institución; la
instalación y la operación del servidor están en la [guía de operación](../operacion/instalacion-y-operacion.md).

> [!NOTE]
> La auditoría registra **quién hizo qué y cuándo**, pero no guarda nombres de estudiantes, notas ni el texto de los mensajes
> del chat. Las reglas de dificultad señalan situaciones que vale la pena revisar; no son un diagnóstico.

## 1. Quién puede administrar

La administración es para quien tenga el permiso **Administrar el asistente de IA** (`local/ai_assistant:administer`). Moodle
lo da por defecto al rol **Gestor** cuando está asignado en el sistema; los docentes y los estudiantes no lo reciben. Para
dárselo a otra persona, asígnale un rol de gestión en **Administración del sitio ▸ Usuarios ▸ Permisos ▸ Asignar roles
del sistema**.

En la página del asistente de cualquier curso, la lista de permisos de **Conexión con el backend** muestra «Administrar el
asistente: Sí» y, más abajo, aparece la sección **Administración**. Quien no tiene el permiso no ve esa sección.

## 2. Consultar la auditoría

En **Administración ▸ Auditoría** verás los eventos del más reciente al más antiguo, con la fecha, la acción, el id de
usuario de Moodle, el id del curso, el resultado (**Correcto**, **Denegado** o **Error**) y un detalle sin datos personales.

Filtros (todos opcionales; se combinan):

| Filtro                      | Ejemplo                                                                          |
| --------------------------- | -------------------------------------------------------------------------------- |
| Acción                      | `proposal.publish`, o un dominio completo terminado en punto: `auth.` o `rules.` |
| Resultado                   | Denegado (accesos rechazados, límites de uso)                                    |
| Id de usuario / id de curso | Lo que hizo una persona, o lo que pasó en un curso                               |
| Desde / hasta               | Un rango de fechas y horas                                                       |

Pulsa **Cargar más** para ver la página siguiente (50 eventos por página). Consultar la auditoría también deja un evento
(`audit.query`), para saber quién la miró.

Acciones que verás con frecuencia:

| Acción                                            | Qué significa                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `auth.denied`, `access.denied`                    | Un token inválido o un acceso a un curso o a una función sin permiso     |
| `rate.limited`, `assistant.quota_exceeded`        | Se pasó el límite de peticiones por minuto o el tope diario de uso de IA |
| `syllabus.*`, `proposal.*`                        | Carga y extracción de sílabos; propuestas, aprobación y publicación      |
| `assistant.chat`                                  | Un mensaje al asistente (solo cantidades y el resultado, no el texto)    |
| `analytics.course_view`, `analytics.student_view` | Consulta del panel o de las evidencias de un estudiante                  |
| `rules.update`, `rules.reset`                     | Cambio o restablecimiento de una regla de dificultad                     |

## 3. Configurar las reglas de dificultad

En **Administración ▸ Reglas de dificultad** eliges a quién configuras: **Toda la institución** o **Este curso**. Una regla
del curso **reemplaza** a la institucional del mismo tipo; si no hay ninguna, se usa el valor por defecto. Cada tarjeta
indica de dónde sale la configuración actual (**Por defecto**, **Institución** o **Este curso**).

| Regla                               | Qué detecta                                                     | Valores (por defecto)                                                |
| ----------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| Actividades vencidas sin entregar   | Estudiantes con tareas vencidas sin entrega                     | Mínimo de actividades (2); ventana en días (opcional)                |
| Notas por debajo de un umbral       | Notas menores a un porcentaje de la nota máxima                 | Umbral (60 %); mínimo de actividades (2); ventana en días (opcional) |
| Descenso sostenido                  | Notas consecutivas, cada una menor que la anterior              | Notas consecutivas (de 3 a 10; 3); ventana en días (opcional)        |
| Dificultad repetida en un resultado | Notas bajas en actividades de un mismo resultado de aprendizaje | Umbral (60 %); mínimo de actividades (2); ventana en días (opcional) |

Para cambiar una regla: ajusta los valores, deja marcada o desmarca **Regla activa** y pulsa **Guardar**. Un valor fuera de rango se
marca en rojo y no se envía. **Quitar esta configuración** devuelve la regla al nivel anterior (del curso a la institución, de la
institución al valor por defecto). Los cambios se aplican a las señales de los docentes la próxima vez que abran el panel.

> [!TIP]
> Antes de cambiar una regla de toda la institución, pruébala en un curso. Un umbral muy alto llena el panel de señales (en el curso
> de prueba, un umbral de 95 % pasó de 4 a 13 señales) y un umbral muy bajo deja de avisar.

## 4. Preguntas frecuentes

| Pregunta                                         | Respuesta                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| No veo la sección Administración                 | No tienes el permiso `administer`, o el plugin no se actualizó (ver la guía de operación) |
| Una regla de un curso no cambia el panel         | El docente debe abrir el panel de nuevo; las reglas se leen cada vez que se calcula       |
| ¿Puedo ver qué preguntó un docente al asistente? | No: la auditoría solo guarda cantidades y resultados, no el texto de los mensajes         |
| ¿Quién ve las evoluciones de los indicadores?    | Cada docente ve solo las suyas; el administrador no las consulta desde esta pantalla      |
