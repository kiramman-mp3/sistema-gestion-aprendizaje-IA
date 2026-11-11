# ADR-023: Proveedor Gemini para el asistente, la extracción y los embeddings

- **Estado:** Propuesta (D-07 sigue abierta: la institución debe aprobar proveedor, plan y presupuesto)
- **Fecha:** 2026-11-10
- **Sprint:** S5, S8, S9 y S11 (cierre de lo que dependía de un modelo real)

## Contexto

El backend solo tenía el proveedor de demostración (`AI_PROVIDER=mock`). Para medir el sistema con un modelo real, el equipo
dispone de una clave de la API de Gemini de un plan gratuito, que se usa **solo con datos sintéticos** (el curso
`AN-401-PRUEBA` y los 12 sílabos ficticios). La política de datos con proveedores externos (D-08) está pendiente, así que
nada real sale a Google.

## Decisión

1. Se añade `GeminiLlmProvider` y `GeminiEmbeddingProvider` detrás de las interfaces de ADR-009. Se activan con
   `AI_PROVIDER=gemini` y `AI_API_KEY`; sin la clave el backend no arranca. `mock` sigue siendo el valor para pruebas.
2. Se usa la API REST con `fetch` (sin SDK): cabecera `x-goog-api-key`, `streamGenerateContent?alt=sse` para el chat,
   `responseJsonSchema` para la salida estructurada, `functionDeclarations` para las herramientas y
   `batchEmbedContents` para los embeddings. La clave nunca viaja en la URL ni se registra.
3. Las firmas de pensamiento (`thoughtSignature`) de las llamadas a herramientas se devuelven al modelo en el turno
   siguiente; sin ellas la API rechaza la conversación.
4. Modelo de chat y extracción: `AI_MODEL` (por defecto `gemini-3.5-flash`). Embeddings: `gemini-embedding-001` con 1024
   dimensiones (`outputDimensionality`, normalizados a norma 1), el tamaño de la columna `vector(1024)` de ADR-019. El
   nombre guardado con cada fragmento es `<modelo>-<dimensiones>`; la búsqueda y la reindexación filtran por ese nombre, de
   modo que cambiar de modelo reindexa sin mezclar espacios vectoriales.
5. Los errores `429` y `503` transitorios se repiten hasta dos veces, esperando lo que indica Google (`retryDelay`) si es de
   15 s o menos. Un límite diario no se repite. Si no hay respuesta, el sistema responde `503 AI_PROVIDER_UNAVAILABLE`
   (el contrato ya existente).
6. El sistema fija `schemaVersion` de la extracción (el modelo lo escribía mal): el esquema que se pide al modelo no lo
   incluye y el extractor lo añade.
7. La similitud mínima de la búsqueda en documentos es configurable (`AI_EMBEDDING_MIN_SCORE`, 0,62 por defecto),
   calibrada con los sílabos sintéticos (ver los [resultados](../../resultados/ia-real-sintetica.md)). Los
   embeddings de demostración usan su propio umbral.

## Alternativas consideradas

| Alternativa                               | Por qué no se eligió                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| SDK oficial de Google                     | Añade una dependencia y oculta los reintentos y los errores que necesitamos controlar              |
| Otro proveedor (OpenAI, Anthropic, local) | Sigue siendo posible: basta otra clase tras `LlmProvider`; no se tenía una clave para probarlo     |
| Modelo local (Ollama)                     | Requiere hardware que el servidor del instituto no tiene confirmado; se deja como alternativa D-07 |

## Consecuencias

- El plan gratuito **no sirve para el piloto**: tiene cuota diaria baja (20 solicitudes por modelo y día en las pruebas), los
  límites cambian sin aviso y, según los términos del plan gratuito, los datos pueden usarse para mejorar los productos de
  Google. Para datos reales hace falta un plan de pago con términos de datos aceptables, decisión de la institución
  (D-07 y D-08).
- Los modelos de la familia cambian de nombre y se retiran (`gemini-2.5-flash` ya devolvía 404); por eso el modelo es una
  variable de entorno y no una constante.
- Las cifras medidas con este proveedor son sintéticas y orientativas; no son las métricas de la tesis.
