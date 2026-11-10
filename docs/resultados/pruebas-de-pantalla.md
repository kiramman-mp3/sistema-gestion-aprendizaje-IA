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
| Subir sílabo → extraer con IA → editar y guardar → generar propuesta                        | Funciona de punta a punta hasta la propuesta; se detuvo antes de aprobar y publicar para no alterar el curso de prueba                                                                           |
| Generar una segunda propuesta para el mismo sílabo                                          | El backend responde 409 y la pantalla ofrece abrir la existente o crear otra                                                                                                                     |
| Error 503 real (segundo backend con una clave inválida)                                     | Aviso claro, sin respuesta inventada; la pregunta vuelve al cuadro                                                                                                                               |
| Error 429 real (segundo backend con tope de un mensaje por día)                             | Aviso con la espera; la pregunta vuelve al cuadro                                                                                                                                                |
| Interrupción con «Detener» durante la respuesta                                             | Se muestra «La respuesta se interrumpió y puede estar incompleta»                                                                                                                                |
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
| Al fallar, queda una burbuja vacía del asistente sobre el aviso de error              | Abierto, de aspecto menor                                                                                                                     |
| El estudiante recibe HTTP 500 con la traza de Moodle                                  | Es el comportamiento de Moodle con el modo de depuración de desarrollo activado ante un permiso faltante; revisar que producción no lo active |
| Tras una interrupción la pregunta no vuelve al cuadro                                 | Intencional: ya hay una respuesta parcial en la conversación                                                                                  |

## Pendiente

- Aprobar y publicar la propuesta en el navegador (CU-03 se verifica con `pnpm smoke:publicacion` pero no se capturó en pantalla).
- Verificar con teclado y lector de pantalla (accesibilidad, RNF); aquí solo se hizo con el ratón.
- Probar en otros navegadores y en pantallas pequeñas.
- La capacitación impartida y sus capturas (piloto, depende de la institución).
