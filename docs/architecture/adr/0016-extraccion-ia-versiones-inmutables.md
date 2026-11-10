# ADR-016: Extracción con IA en el proceso de la API, con versiones inmutables

- **Estado:** Aceptada
- **Fecha:** 2026-11-10
- **Sprint:** S5

## Contexto

La extracción estructurada (RF-05) es una llamada a un proveedor externo que puede tardar decenas de
segundos y fallar. El docente corrige después el resultado (RF-06), y la propuesta de curso se genera a partir
de una versión concreta. La extracción de texto del Sprint 4 ya usa una cola de BullMQ con un worker aislado
porque procesa archivos no confiables; la llamada a la IA no procesa archivos, solo texto ya validado.

## Decisión

1. `POST /syllabi/:id/extract` marca el sílabo `PROCESSING` con un `UPDATE` condicional (dos peticiones a la
   vez no lanzan dos extracciones), responde 202 y ejecuta la extracción dentro del proceso de la API. Una
   extracción en `PROCESSING` de más de 10 minutos se considera perdida y puede reintentarse.
2. Cada resultado, de la IA (`source: AI`) o del docente (`source: TEACHER`), es una fila nueva e inmutable de
   `syllabus_extractions`, con `UNIQUE(document_id, version)`. Dos revisiones simultáneas chocan con esa
   restricción y la segunda responde `409 VERSION_CONFLICT`.
3. `REVIEWED` es el estado que habilita la propuesta. Desde `REVIEWED` no se vuelve a extraer.
4. Lo que devuelve el modelo no se acepta tal cual: se valida con el esquema v1 y cada fecha y ponderación se
   comprueba contra el texto del documento; lo que no está escrito se anula y queda en `uncertainFields`.

## Alternativas consideradas

| Alternativa                                       | Por qué no se eligió                                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Cola de BullMQ para la extracción con IA          | Añade una pieza y un estado más sin necesidad hoy: el trabajo no es pesado en CPU ni procesa archivos. Se reconsidera si el volumen lo pide |
| Sobrescribir la extracción al revisar             | Pierde la trazabilidad de qué propuso la IA y qué corrigió el docente, y rompe la propuesta ya generada                                     |
| Aceptar la salida del modelo si cumple el esquema | Un esquema válido no garantiza que las fechas y ponderaciones existan en el sílabo (sección 6.2 de los requisitos)                          |

## Consecuencias

- Si la API se reinicia a mitad de una extracción, el sílabo queda en `PROCESSING` hasta que se reintente o
  pasen 10 minutos.
- La extracción ocupa el proceso de la API mientras espera al proveedor; el tiempo máximo es `AI_TIMEOUT_MS`.
- El historial de versiones permite medir el F1 de la IA frente a lo que el docente terminó aceptando.
- La verificación contra el texto no distingue contenido de instrucción cuando el propio documento contiene el
  valor: la revisión del docente sigue siendo obligatoria.
