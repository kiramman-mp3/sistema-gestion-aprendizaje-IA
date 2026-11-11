# Pruebas de pantalla en un navegador real

Realizadas el 2026-11-10 con Chromium (Playwright), Moodle 5.1.8 local, el backend con el proveedor de IA real
([ADR-023](../architecture/adr/0023-proveedor-gemini-y-modelos.md)) y el curso sintético `AN-401-PRUEBA`. Todos los
datos son ficticios; las capturas están en [`docs/capturas/`](../capturas/) y en el README.

> [!NOTE]
> Son pruebas manuales guiadas con un script desechable, no una suite automatizada: el script no está en el
> repositorio. Cubren lo que las pruebas del plugin en un DOM simulado no pueden: el navegador real, Moodle real y el
> backend real juntos.

## Qué se probó

| Prueba                                                                                      | Resultado                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Docente abre el asistente: conexión, sílabo, chat, analítica y relación de actividades      | Se muestran las cinco secciones y la conexión con el backend; sin errores de JavaScript en la consola                                                                                            |
| Chat con respuesta real y fuentes                                                           | Responde con las 4 entregas por calificar, las actividades por su título y los estudiantes con su nombre resuelto en el navegador                                                                |
| Analítica: indicadores, señales y evidencias de un estudiante                               | Se muestran con su definición; las evidencias separan lo observado, lo calculado y la información que falta                                                                                      |
| Subir sílabo → extraer con IA → editar y guardar → generar propuesta                        | Funciona de punta a punta hasta la propuesta                                                                                                                                                     |
| Aprobar y publicar la propuesta (en un curso desechable `PUB-PRUEBA`, borrado después)      | Se crearon las 4 secciones en Moodle con su descripción, el resumen enlaza a cada una y la pantalla pasa a «Publicada» y de solo lectura                                                         |
| Generar una segunda propuesta para el mismo sílabo                                          | El backend responde 409 y la pantalla ofrece abrir la existente o crear otra                                                                                                                     |
| Error 503 real (segundo backend con una clave inválida)                                     | Aviso claro, sin respuesta inventada; la pregunta vuelve al cuadro                                                                                                                               |
| Error 429 real (segundo backend con tope de un mensaje por día)                             | Aviso con la espera; la pregunta vuelve al cuadro                                                                                                                                                |
| Interrupción con «Detener» durante la respuesta                                             | Se muestra «La respuesta se interrumpió y puede estar incompleta», sin burbuja vacía                                                                                                             |
| Acceso por rol (docente, segundo docente, tutor, administrador, estudiante, ajeno al curso) | Docente y tutor ven chat, analítica y relación de actividades; solo el administrador ve la administración; el estudiante recibe el rechazo de Moodle y el ajeno ve las opciones de matriculación |
| Pantalla de administración: auditoría y reglas de dificultad                                | Carga; la auditoría muestra los intentos fallidos y el límite como «Error» y «Denegado»                                                                                                          |

Los errores 503 y 429 se provocaron de verdad (no con respuestas simuladas): se levantaron dos instancias adicionales del
backend contra la misma base, una con una clave de IA inválida y otra con un tope de un mensaje por día, y se apuntó el
ajuste `backendurl` del plugin a cada una por turnos. Al terminar se restauró el valor original y se detuvieron las
instancias.

## Hallazgos y lo que se corrigió

| Hallazgo                                                                              | Acción                                                                                                                                        |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| La respuesta mostraba Markdown sin interpretar (`**Actividad**`, comillas invertidas) | Corregido: el prompt pide texto plano (la pantalla inserta texto, no HTML, a propósito)                                                       |
| La respuesta nombraba las actividades por su `cmid` («Actividad (cmid 35)»)           | Corregido: el prompt pide el título y consultar `get_course_activities` si hace falta; ahora responde «Tarea 2: Análisis exploratorio»        |
| El límite de uso decía «en 64541 segundos»                                            | Corregido: segundos hasta 2 minutos, minutos hasta 2 horas y horas después («unas 18 horas»); con prueba unitaria                             |
| Tras un 503 o un 429 el docente tenía que escribir de nuevo la pregunta               | Corregido: la pregunta vuelve al cuadro cuando el servicio la rechaza antes de responder                                                      |
| Al fallar, queda una burbuja vacía del asistente sobre el aviso de error              | Corregido: sin texto no se dibuja la burbuja, solo el aviso; con prueba del plugin                                                            |
| El estudiante recibe HTTP 500 con la traza de Moodle                                  | Es el comportamiento de Moodle con el modo de depuración de desarrollo activado ante un permiso faltante; revisar que producción no lo active |
| Tras una interrupción la pregunta no vuelve al cuadro                                 | Intencional: ya hay una respuesta parcial en la conversación                                                                                  |

## Estructura del curso en pocos pasos (2026-11-11)

Con [ADR-024](../architecture/adr/0024-estructura-del-curso-en-pocos-pasos.md) se probó en Chromium, con Moodle, el backend
y Gemini reales y un curso desechable (`PUB-PRUEBA2`, borrado después):

| Paso del docente                                           | Resultado                                                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Elegir el archivo y pulsar **Subir y crear la estructura** | Sin más clics, a los 19 segundos aparece el editor con la extracción                          |
| **Guardar y generar la propuesta de curso**                | Guarda la revisión (versión 2) y genera la propuesta con sus secciones                        |
| **Aprobar y publicar** antes de marcar la casilla          | Deshabilitado                                                                                 |
| Marcar la casilla y pulsar **Aprobar y publicar**          | Se aprueba y se publica; se crearon las secciones del sílabo y el curso de Moodle las muestra |

Al volver a abrir la página del curso sin nada en la dirección, el plugin retomó el sílabo revisado (versión 2, del docente) y
la propuesta pendiente de revisión con `GET /syllabi/latest` y `GET /proposals/latest`; antes, ese trabajo solo se veía si
la dirección llevaba `syllabusid` y `proposalid`. La primera carga tras limpiar la caché de Moodle tardó más de 5
segundos en mostrar el editor; la segunda fue inmediata.

Las pruebas del plugin cubren además: la extracción automática solo con el botón principal, la excepción del texto de OCR
de baja confianza, el fallo de la extracción, el orden aprobar y luego publicar con `confirm: true` y clave de
idempotencia, que no se publique si la aprobación falla y que el bloque no aparezca fuera de la revisión.

Al levantar el worker a mano para esta prueba hay que pasar `WORKER_STORAGE_SOURCE=./apps/api/var/storage`; sin eso el
texto del sílabo falla con `TEXT_EXTRACTION_FAILED`.

## Navegadores, pantalla pequeña y accesibilidad

El mismo recorrido del docente (cargar la página, ver las cuatro secciones, preguntar «¿Qué hay pendiente de calificar?» y
comprobar la respuesta con datos reales) se repitió así:

| Entorno                                     | Resultado                                                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Chromium 156, 1280 px                       | Correcto, sin errores de JavaScript                                                                                          |
| Firefox, 1280 px y 390 px                   | Correcto, sin errores de JavaScript                                                                                          |
| WebKit 27 (Safari), 1280 px y 390 px        | Correcto; la consola registra un error de Moodle al descargar cadenas de idioma al navegar (código de Moodle, no del plugin) |
| Chromium, 390 px (móvil) y 768 px (tableta) | Correcto; el chat completa la pregunta en el móvil                                                                           |
| Desbordamiento horizontal                   | 0 px en todos los anchos probados                                                                                            |

Accesibilidad, solo con herramientas automáticas y teclado:

- **axe-core 4.10.2** (WCAG 2.0 y 2.1, A y AA) sobre la región del plugin: **0 violaciones**.
- **Teclado:** con 12 pulsaciones de Tab se llega al cuadro de pregunta, se escribe, Tab pasa a «Enviar» y Enter envía; al
  terminar el foco vuelve al cuadro. La zona de mensajes es `aria-live="polite"`.
- **No se probó con un lector de pantalla** (NVDA, VoiceOver) ni se revisó el indicador de foco de cada control; axe no
  sustituye una revisión manual.

Observaciones menores:

- Justo al terminar una respuesta, durante un instante se ven los estudiantes como «Estudiante 28» (el id de Moodle) hasta
  que el navegador resuelve los nombres; después se reemplazan. Es el comportamiento previsto (ADR-017), pero un lector
  de pantalla podría anunciar la etiqueta provisional.
- El primer intento de inicio de sesión en Moodle con el navegador automatizado a veces responde «Acceso inválido» y el
  segundo entra. Ocurre antes de llegar al plugin y no se investigó; el script reintenta.

## Pendiente

- Verificar con un lector de pantalla y revisar el indicador de foco control por control.
- Probar con un teléfono físico y con una versión de Safari real (WebKit de Playwright no es idéntico).
- La capacitación impartida y sus capturas (piloto, depende de la institución).
- **Medir la latencia (RNF-01 a RNF-03): no se puede hasta tener la licencia de pago del proveedor de IA.** Ver
  [Latencia](ia-real-sintetica.md) en los resultados con el modelo real.
