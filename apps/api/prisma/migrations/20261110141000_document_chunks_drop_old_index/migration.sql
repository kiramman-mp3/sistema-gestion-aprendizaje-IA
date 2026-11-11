-- El índice único (document_id, chunk_index) del migration anterior reemplaza al índice simple.
DROP INDEX IF EXISTS "document_chunks_document_id_chunk_index_idx";
