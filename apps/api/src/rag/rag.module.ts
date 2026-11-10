import { Module } from "@nestjs/common";
import { ChunkSearchService } from "./chunk-search.service";
import { DocumentIndexService } from "./document-index.service";

/** Indexación y búsqueda de los documentos de un curso (RF-14, ADR-019). */
@Module({
  providers: [DocumentIndexService, ChunkSearchService],
  exports: [DocumentIndexService, ChunkSearchService],
})
export class RagModule {}
