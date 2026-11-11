# ADR-024: Estructura del curso en pocos pasos, con dos puntos de revisión

- **Estado:** Aceptada
- **Fecha:** 2026-11-11
- **Sprint:** S5 a S7 (ajuste de interfaz sobre el flujo ya construido)

## Contexto

Crear las secciones de un curso desde el sílabo exigía cinco decisiones separadas: subir el archivo, pedir la
extracción, guardar la revisión, generar la propuesta y aprobarla y publicarla con una confirmación aparte. Los docentes
del piloto tendrían que recordar el orden y volver a pulsar entre cada espera. Se quiso reducir los clics sin quitar la
revisión humana, que es parte del diseño: RF-06 (el docente revisa la extracción), RF-08 y RF-09 (la propuesta se aprueba y
la publicación se confirma de forma explícita), ADR-014 y ADR-015.

## Decisión

El docente conserva **dos puntos de revisión** y el resto se encadena:

1. **«Subir y crear la estructura»** (botón principal): sube el archivo, espera el texto y, sin más clics, pide la
   extracción y abre el editor. «Subir sílabo» sigue existiendo y **solo lee el texto**, sin llamar a la IA.
2. **Revisión de la extracción.** El botón **«Guardar y generar la propuesta de curso»** guarda la versión revisada y genera la
   propuesta. Si la versión en pantalla ya es del docente y no tiene cambios, solo genera (dice «Generar la propuesta de
   curso»). Si guardar falla, no se genera nada.
3. **Revisión de la propuesta.** El bloque **«Aprobar y publicar»** pide **una** casilla de confirmación explícita y hace
   las dos llamadas: `POST /proposals/:id/approve` y, solo si la aprobación fue bien, `POST /proposals/:id/publish` con
   `confirm: true` y su clave de idempotencia. «Aprobar la propuesta» a secas sigue disponible.

Reglas que se mantienen:

- **Nada se crea en Moodle sin la confirmación explícita.** El bloque no aparece si la propuesta no está en revisión; una
  propuesta ya aprobada muestra el panel de publicación de siempre con su propia casilla.
- **El backend no cambia.** Aprobar y publicar siguen siendo operaciones separadas, con su auditoría (quién aprobó y
  cuándo), su máquina de estados y la idempotencia. Solo la interfaz las encadena. No hay migración ni cambios en
  `docs/api/openapi.yaml`.
- **Con texto de OCR de baja confianza no se sigue solo.** El docente ve el aviso y decide si extraer con el botón de
  siempre.
- **El encadenado vive en el navegador.** Si el docente cierra la página, la extracción en curso termina en el servidor y
  puede retomarla con `index.php?courseid=<id>&syllabusid=<uuid>`, pero no avanza sola hasta la propuesta.
- **Aviso de privacidad en el propio botón:** el texto de ayuda dice que «Subir y crear la estructura» envía el texto del
  archivo al proveedor de IA y que «Subir sílabo» no lo envía (D-08).

## Alternativas consideradas

| Alternativa                                                                    | Por qué no se eligió                                                                                                                                                 |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publicar sin revisión (automático total)                                       | Un error del modelo (ponderaciones que no suman, un título mal escrito) llegaría al curso de los estudiantes; contradice RF-06, RF-08 y RF-09 y el marco de la tesis |
| Encadenar en el servidor al terminar el texto, sin que el docente pulse        | Enviaría el texto a un proveedor externo sin una acción explícita (D-08) y exigiría una columna y una migración; el docente ya está esperando en la página           |
| Generar la propuesta desde la extracción de la IA sin que el docente la guarde | Rompería la regla `EXTRACTION_NOT_REVIEWED`: guardar la revisión es el acto con el que el docente hace suya la extracción                                            |
| Un único botón de «Aprobar y publicar» sin casilla                             | Quitaría la confirmación explícita; se pide una sola casilla, no dos                                                                                                 |

## Consecuencias

- De elegir el archivo a tener las secciones en Moodle bastan **3 botones y una casilla** (subir y crear, guardar y
  generar, confirmar y aprobar y publicar), más la revisión que el docente quiera hacer entre uno y otro. Antes eran 7
  acciones: subir, extraer, guardar, generar, aprobar, la casilla y publicar. Se verificó en un navegador real con Gemini
  y un sílabo ficticio: el editor apareció a los 19 segundos de pulsar el primer botón y se crearon las 4 secciones.
- El docente puede aprobar y publicar sin leer la propuesta: la interfaz muestra las advertencias y bloquea los errores,
  pero no obliga a leerla. Es una decisión de usabilidad que el piloto debe valorar (encuesta SUS y entrevistas).
- Los textos de la interfaz son nuevos (`syllabuscreatestructure*`, `extraction_saveandgenerate`,
  `proposal_approveandpublish*`) y están en inglés y en español.
