-- RAG (Sprint 9, ADR-019): vectores de 1024 dimensiones, el tamaño de los embeddings de demostración.
-- Con el modelo real (D-07) hay que cambiar la dimensión en una migración nueva y reindexar los fragmentos.
-- La tabla está vacía hasta ahora, por lo que el cambio de tipo no necesita conversión.
ALTER TABLE "document_chunks" ALTER COLUMN "embedding" TYPE vector(1024);

-- Búsqueda por similitud de coseno. El filtro por curso va siempre en el WHERE de la consulta (RF-14).
CREATE INDEX "document_chunks_embedding_hnsw" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);

-- Un fragmento por posición dentro del documento: reindexar no duplica.
CREATE UNIQUE INDEX "document_chunks_document_id_chunk_index_key" ON "document_chunks" ("document_id", "chunk_index");
