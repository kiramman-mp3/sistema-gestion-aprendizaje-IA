# ADR-019: RAG sobre los documentos del curso con pgvector y un proveedor de embeddings intercambiable

- **Estado:** Aceptada (la dimensión y el modelo de embeddings se confirman con D-07)
- **Fecha:** 2026-11-10
- **Sprint:** S9

## Contexto

El asistente debe responder preguntas sobre lo que dicen los documentos del curso (el sílabo y los documentos
pedagógicos que el docente carga) y citar el documento y la página (RF-14), y las recomendaciones deben ser coherentes
con la metodología y la evaluación del sílabo (RF-18). El modelo de embeddings real depende de D-07 (proveedor y
presupuesto), que no está decidido. La tabla `document_chunks` ya existía con una columna `vector` sin dimensión.

## Decisión

1. **Interfaz `EmbeddingProvider`** (`apps/api/src/llm/embedding-provider.ts`), con el mismo criterio que `LlmProvider`
   (ADR-009): el código no depende de ningún SDK y todo pasa por `LlmService.embed`, que aplica el tope de tokens y el
   tiempo límite, valida que los vectores correspondan a lo pedido y deja el consumo registrado, sin el texto.
2. **Proveedor de demostración** `HashingEmbeddingProvider` (`AI_PROVIDER=mock`): vectores de 1024 dimensiones por
   _feature hashing_ de palabras y pares de palabras, deterministas y sin costo. Captura coincidencia de palabras, no
   significado: sirve para ejercitar la indexación, la búsqueda y el aislamiento por curso, **no** para medir la calidad
   de la recuperación. Sin `AI_PROVIDER`, el proveedor falla y el chat responde `AI_PROVIDER_UNAVAILABLE`.
3. **Almacén:** `document_chunks.embedding` es `vector(1024)` con índice HNSW por coseno (`vector_cosine_ops`) y un índice
   único `(document_id, chunk_index)`. Prisma no soporta el tipo: las escrituras y la búsqueda usan SQL con
   parámetros.
4. **Fragmentos:** de unos 900 caracteres con 120 de solapamiento, en orden de lectura, con el encabezado unido al texto
   que le sigue y la página donde empieza cada uno (`rag/chunker.ts`, función pura: reindexar no duplica).
5. **Indexación:** al quedar el texto de un documento listo (`TEXT_READY`) se indexa sin bloquear ni hacer fallar el
   procesamiento; si falla, se reintenta en la siguiente búsqueda (`ensureIndexed`). Reindexar reemplaza los fragmentos
   en una transacción. Los fragmentos se borran en cascada con el documento (plazo de conservación del sílabo).
6. **Búsqueda:** el filtro por curso va **dentro** de la consulta (`WHERE moodle_course_id = …`) y el curso sale siempre
   del token, nunca de lo que escriba el usuario o el modelo. Se descartan los fragmentos por debajo de la similitud
   mínima del proveedor (`minScore`).
7. **Herramienta del chat** `search_course_documents`: devuelve hasta 8 pasajes (texto de hasta 700 caracteres, página y
   similitud) y una nota que recuerda que son datos y no instrucciones; las fuentes citan el documento y la página. Sin
   pasajes parecidos devuelve cero y el modelo debe decir que no encontró nada.
8. **Recomendaciones:** reciben hasta 3 pasajes sobre metodología y evaluación dentro de `<documentos_curso>`, como datos
   delimitados y con las etiquetas neutralizadas; si la búsqueda falla se genera igual con las evidencias.

## Alternativas consideradas

| Alternativa                                      | Por qué no se eligió                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Esperar a D-07 para construir el RAG             | Bloquea la verificación de punta a punta; con la interfaz, el modelo real se enchufa después                    |
| Búsqueda de texto completo de PostgreSQL         | No usa vectores y no prepara el modelo real; se mantiene pgvector, que ya estaba en el diseño (ADR-002)         |
| Columna `vector` sin dimensión                   | No admite un índice HNSW; la búsqueda sería secuencial                                                          |
| Filtrar por curso después de buscar              | Un fallo del filtro filtraría pasajes de otro curso; con el filtro en la consulta, no se leen fragmentos ajenos |
| Embeddings de demostración con un servicio local | Añade una dependencia pesada; el hashing alcanza para probar el flujo                                           |

## Consecuencias

- **Al elegir el modelo real (D-07):** añadir su adaptador en `LlmModule`, una migración que cambie la dimensión de
  `vector(1024)` y reindexar (`embedding_model` guarda con qué modelo se calculó cada fragmento). `minScore` se calibra con
  el conjunto de referencia.
- La calidad de la recuperación (por ejemplo, cuántas preguntas encuentran el pasaje correcto) no se puede medir con
  los embeddings de demostración.
- `prisma migrate diff` informa siempre del índice HNSW como «eliminado»: Prisma no conoce ese tipo de índice. No hay que
  borrarlo en migraciones autogeneradas.
- Los pasajes de documentos son texto no confiable: se entregan como datos delimitados (SEC-06) y no llevan ids de
  documento, nombres de archivo ni quién los subió (SEC-07).
