# Manual del docente

Cómo usar el asistente docente con IA dentro de Moodle. Está escrito para quien enseña un curso; no hace falta
saber nada técnico.

> [!NOTE]
> El asistente **propone y tú decides**. No crea nada en tu curso sin que lo apruebes y confirmes, no califica y no
> da diagnósticos sobre tus estudiantes: te muestra datos de Moodle y sugerencias que puedes aceptar o no.
> Las pantallas que usan inteligencia artificial (extraer el sílabo, el chat y las recomendaciones) funcionan cuando
> la institución activa el proveedor de IA; el resto (cargar, revisar, aprobar y publicar la estructura) no depende de él.

## 1. Entrar al asistente

1. Abre tu curso en Moodle.
2. En el menú **Más**, elige **Asistente IA** (en inglés, _AI assistant_).
3. Arriba verás **Conexión con el backend**. Si dice **Conectado**, verás tus permisos: usar el asistente, publicar y
   ver analítica. Si muestra un error, avisa al administrador.

Solo los docentes ven esta página: los estudiantes no.

## 2. Crear la estructura del curso desde el sílabo

### Paso 1 · Subir el sílabo

1. En **Sílabo del curso**, elige el archivo **PDF o DOCX** (hasta 10 MB). Tienes dos botones:
   - **Subir y crear la estructura** (el recomendado): sube el archivo, lee su texto y **sigue solo** con el paso 2. El
     texto del archivo se envía al proveedor de IA.
   - **Subir sílabo**: solo sube el archivo y lee su texto, sin usar la IA. Después puedes pulsar tú el paso 2.
2. Espera: el sistema revisa el archivo (antivirus, formato) y extrae su texto. Verás el progreso.
3. Si el archivo ya se subió antes al curso, el sistema te lo dice y te muestra el estado del existente.
4. Si el PDF es una imagen escaneada, el texto se lee con reconocimiento óptico y el sistema te avisa de que **debes
   revisarlo con más cuidado**.

Archivos que se rechazan: con una extensión que no corresponde a su contenido, con macros, con virus o protegidos con
contraseña (quita la protección y vuelve a subirlo).

### Paso 2 · Extraer la estructura

Con **Subir y crear la estructura** este paso ocurre solo y se abre la revisión cuando termina. Con **Subir sílabo**, o si
el texto viene de un escaneo de baja confianza (el sistema te avisa y no continúa solo), pulsa **Extraer la estructura
del curso** cuando el texto esté listo. El asistente propone unidades, temas, resultados de aprendizaje, fechas y
ponderaciones. **No inventa**: lo que el sílabo no dice queda vacío y marcado.

### Paso 3 · Revisar y corregir

Aparece **Revisar la estructura extraída**. Verás:

- **Curso**, **resultados de aprendizaje**, **periodos de calificación** con sus **unidades** y **actividades**,
  metodologías, recursos, instrumentos de evaluación y bibliografía.
- Una **insignia amarilla** en cada campo del que el asistente no está seguro (_No está en el sílabo_, _Ambiguo_,
  _Poca confianza_, _Inconsistente_), con la página del sílabo de donde salió. Edita el campo o pulsa **Marcar como revisado**.
- **Advertencias de coherencia**: por ejemplo, ponderaciones que no suman 100, una entrega fuera del rango de su
  unidad o una actividad sin resultado de aprendizaje. No impiden guardar, pero conviene revisarlas.
- Un valor inválido (un porcentaje fuera de 0 a 100, una fecha que no existe) se marca en rojo y **bloquea el
  guardado** hasta corregirlo.

Puedes agregar y quitar elementos. Pulsa **Guardar revisión** si solo quieres guardar: cada guardado crea una versión
nueva y las anteriores se conservan. Si sales con cambios sin guardar, el navegador te avisa.

### Paso 4 · Generar la propuesta

Pulsa **Guardar y generar la propuesta de curso**: guarda tu revisión (o la del asistente tal como está, si no cambiaste
nada) y genera la propuesta. Guardar es lo que convierte la extracción en tu revisión, así que revísala antes. Si ya
guardaste y no hay cambios, el botón dice **Generar la propuesta de curso**. El asistente convierte cada unidad en una
**sección** y cada actividad en un elemento de Moodle (**tarea**, **foro**, **cuestionario vacío**, **etiqueta** o
**página**). Las fechas y ponderaciones son solo las del sílabo.

Si el sílabo ya tiene una propuesta, te pregunta si quieres abrirla o crear otra.

### Paso 5 · Editar y aprobar la propuesta

En **Propuesta de curso** puedes cambiar títulos, descripciones, tipo de elemento, fechas, ponderaciones y resultados de
aprendizaje; agregar, quitar y reordenar (flechas ↑ ↓) secciones y actividades.

- Las **observaciones** te dicen qué revisar: los **errores** (por ejemplo, ponderaciones de un periodo que superan 100)
  impiden aprobar; las **advertencias** (una actividad sin resultado de aprendizaje, una sección vacía) no.
- Pulsa **Guardar cambios** y, cuando no queden errores, **Aprobar la propuesta** si solo quieres aprobar, o pasa
  directamente al paso 6 con **Aprobar y publicar**. Se registra quién aprobó y cuándo.
- Si editas una propuesta aprobada, vuelve a revisión: lo aprobado debe ser lo que se publica.

### Paso 6 · Publicar en Moodle

1. Con la propuesta en revisión, marca **Confirmo que quiero aprobar esta propuesta y crear sus elementos en este curso**
   y pulsa **Aprobar y publicar**: se aprueba y se publica de una vez. Si ya la aprobaste por separado, en
   **Publicar en Moodle** marca **Confirmo que quiero crear estos elementos en este curso** y pulsa **Publicar en el curso**.
2. Mientras se publica verás el progreso («2 de 4 elementos creados»). Puedes salir de la página: continúa solo.
3. Al terminar, **Creado en el curso** lista cada sección y actividad con un enlace **Abrir en Moodle**.

> [!IMPORTANT]
> Las actividades se crean **ocultas**. Ábrelas en Moodle, revísalas (sobre todo los cuestionarios, que se crean
> vacíos) y hazlas visibles cuando estén listas.

Si la publicación se detiene (por ejemplo, Moodle dejó de responder), verás qué se creó, qué falló y por qué. Lo creado
se conserva: pulsa **Reanudar la publicación** y se crea solo el resto, **sin duplicados**. Publicar dos veces no crea dos copias.

## 3. Relacionar las actividades con las unidades

En **Actividades y unidades del sílabo** relacionas cada actividad de tu curso con la unidad a la que pertenece y los
resultados que evalúa. Los indicadores por unidad usan esta relación.

- Las actividades creadas desde una propuesta se relacionan solas («Creada desde la propuesta»).
- Para el resto, elige la **unidad** en la lista: se guarda al instante y se proponen los resultados de esa unidad. Marca
  o desmarca los **resultados de aprendizaje** que correspondan. **Sin relacionar** quita la relación.
- Si una relación apunta a una unidad que ya no está en el sílabo, se marca para que elijas de nuevo.
- Necesitas que el sílabo esté revisado (paso 3 de la sección 2).

## 4. Preguntarle al asistente

En **Pregúntale al asistente** escribe preguntas sobre tu curso, por ejemplo: _¿qué estudiantes no entregaron la
tarea 3?_, _¿qué hay pendiente de calificar?_, _¿cómo van las notas de la unidad 2?_ o sobre los documentos del curso.

- **Enter** envía; **Mayús + Enter** hace un salto de línea. Máximo 2000 caracteres.
- La respuesta aparece mientras se escribe, y verás **qué está consultando**. Puedes **Detener** una respuesta en curso.
- Cada respuesta indica la **fecha de la consulta** y sus **fuentes** (con enlace a la actividad o a las
  calificaciones de Moodle; los documentos del curso se citan con su **página**). Si faltaron datos te lo dice:
  _«esta respuesta puede estar incompleta»_.
- Bajo la respuesta puedes abrir **Criterio aplicado**: las reglas con las que se calculó el dato (por ejemplo, _«un
  borrador no cuenta como entrega»_ o _«un estudiante sin nota no cuenta como cero»_), para que puedas verificarla.
- Si tu pregunta es **ambigua** (por ejemplo, _«¿quién no entregó la tarea?»_ y hay varias), el asistente te hace **una sola
  pregunta de aclaración**. Respóndela y te contesta con lo que tenga; no vuelve a preguntar sobre ese tema.
- También puedes preguntar por **lo que dicen los documentos del curso**: _«¿qué dice el sílabo sobre la bibliografía?»_,
  _«¿cómo se evalúa el aprendizaje autónomo?»_. Si no hay nada parecido en los documentos, te lo dice y no inventa.
- Para pedir las **evidencias de un estudiante** necesitas el permiso de ver la analítica; sin él, el asistente no consulta ese dato.
- **No inventa**: si no hay datos para responder, lo dice. Los cálculos de notas los hace el sistema con reglas fijas, no el modelo de IA.
- **Nombres.** Cuando la respuesta habla de estudiantes, verás sus nombres: el asistente trabaja con identificadores y tu
  propia sesión de Moodle pone los nombres. Si un estudiante ya no está en el curso, aparece como «Estudiante 12».
- **Nueva conversación** empieza de cero. Al recargar la página sigues en la conversación de esa pestaña.

Si ves un error:

- _«Alcanzaste el límite de uso… inténtalo de nuevo en N segundos»_: espera ese tiempo y vuelve a preguntar.
- _«El servicio de IA no está disponible»_: no se generó ninguna respuesta; inténtalo en unos minutos.
- _«Esta conversación ya no existe»_: tu pregunta vuelve al cuadro de texto; al enviarla empieza una conversación nueva.
- _«No se aceptó el mensaje»_: debajo se indica qué campo no cumple el formato.

## 5. Analítica del curso y de cada estudiante

Si tienes permiso para ver la analítica, **Analítica del curso** muestra:

- **Indicadores** (por ejemplo, tasa de entrega a tiempo, pendientes de calificar, promedio), cada uno con su definición.
  Un guion (—) significa que no hay dato; no es un cero.
- **Señales para revisar**: estudiantes que cumplen alguna regla de dificultad (faltan entregas obligatorias, nota
  por debajo del umbral, descenso sostenido…), **cada una con su explicación**. Una señal no es un diagnóstico: es algo
  que vale la pena mirar.

### Evolución de los indicadores

Cada vez que abres el panel, el sistema guarda los valores de ese día (como mucho una vez por día y solo para ti: otro docente
no ve los tuyos). Con dos o más visitas aparece la tabla **Evolución**, con una fila por día en que abriste el panel y la
cantidad de señales de ese día. Los días en que no lo abriste **no se rellenan**: la tabla muestra solo lo que se midió. Se
conservan un año.

### Ver las evidencias de un estudiante

Pulsa **Ver evidencias** en una señal. Verás por separado:

- **Observado en Moodle**: los datos tal como están.
- **Calculado**: indicadores calculados con reglas fijas.
- **Información que falta**: lo que no se sabe y por tanto no se puede concluir.

### Recomendaciones pedagógicas

Pulsa **Generar recomendaciones pedagógicas**. Obtienes la evidencia usada, fortalezas, dificultades observadas,
información que falta, estrategias sugeridas, actividades de refuerzo e indicadores de seguimiento. Son **sugerencias, no un diagnóstico**; tú decides qué
hacer. Si no hay datos suficientes, el sistema lo dice y no genera nada.

Después puedes **Registrar tu seguimiento**: qué hiciste (obligatorio) y qué ocurrió (opcional).

## 6. Privacidad

- Los **nombres de los estudiantes no salen de Moodle**: el asistente trabaja con identificadores y los nombres los
  muestra tu propia sesión de Moodle.
- Cada consulta queda registrada en una auditoría sin nombres ni contenido de mensajes. Solo el administrador institucional
  puede consultarla.
- El asistente solo ve los cursos en los que eres docente.

## 7. Preguntas frecuentes

| Pregunta                                                         | Respuesta                                                                                                |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Me equivoqué en la propuesta ya publicada, ¿cómo la corrijo?     | Una propuesta publicada es de solo lectura: corrige directamente en Moodle                               |
| ¿Puedo volver a publicar lo mismo?                               | No se crean duplicados; si algo falló, usa **Reanudar la publicación**                                   |
| No veo el botón **Aprobar la propuesta**                         | Guarda los cambios y corrige los errores marcados en rojo; solo se aprueba desde «Pendiente de revisión» |
| No veo el botón **Publicar**                                     | Necesitas tener la propuesta aprobada y el permiso de publicar en el curso                               |
| Un estudiante aparece como «Estudiante 12» en lugar de su nombre | Moodle no lo lista (por ejemplo, ya no está matriculado) o no se pudieron cargar los nombres             |
| El texto de mi sílabo salió con errores                          | Corrígelo en el editor; si el PDF era una imagen, el reconocimiento óptico puede fallar                  |
