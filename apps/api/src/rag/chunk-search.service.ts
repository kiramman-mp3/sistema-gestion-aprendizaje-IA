import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../database/prisma.service";
import { LlmService } from "../llm/llm.service";
import { DocumentIndexService, toVectorLiteral } from "./document-index.service";

/** Un fragmento encontrado, con su procedencia. */
export interface FoundChunk {
  documentId: string;
  page: number | null;
  content: string;
  /** Similitud de coseno entre 0 y 1; más alta es más parecida. */
  score: number;
}

export const DEFAULT_SEARCH_LIMIT = 5;
export const MAX_SEARCH_LIMIT = 8;

/** Si el proveedor no informa su propio mínimo, un fragmento por debajo de esta similitud no se considera relacionado. */
export const MIN_SCORE = 0.12;

/**
 * Búsqueda de fragmentos en los documentos de un curso (RF-14). **El filtro por curso va dentro de la consulta,
 * antes de ordenar por similitud**: nunca se buscan fragmentos de otros cursos para descartarlos después, y el
 * curso sale del token, no de lo que pida el usuario o el modelo.
 */
@Injectable()
export class ChunkSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly index: DocumentIndexService,
  ) {}

  async search(
    courseId: number,
    query: string,
    limit = DEFAULT_SEARCH_LIMIT,
  ): Promise<FoundChunk[]> {
    const take = Math.min(Math.max(Math.trunc(limit), 1), MAX_SEARCH_LIMIT);
    await this.index.ensureIndexed(courseId);

    const { vectors, model } = await this.llm.embed({
      purpose: "rag_query",
      texts: [query],
      kind: "query",
    });
    const literal = toVectorLiteral(vectors[0]!);
    const rows = await this.prisma.$queryRaw<
      { document_id: string; page: number | null; content: string; score: number }[]
    >(Prisma.sql`
      SELECT document_id, page, content, 1 - (embedding <=> ${literal}::vector) AS score
        FROM document_chunks
       WHERE moodle_course_id = ${courseId}
         AND embedding IS NOT NULL
         AND embedding_model = ${model}
       ORDER BY embedding <=> ${literal}::vector
       LIMIT ${take}`);

    return rows
      .filter((row) => Number(row.score) >= (this.llm.embeddingMinScore ?? MIN_SCORE))
      .map((row) => ({
        documentId: row.document_id,
        page: row.page,
        content: row.content,
        score: Math.round(Number(row.score) * 1000) / 1000,
      }));
  }
}
