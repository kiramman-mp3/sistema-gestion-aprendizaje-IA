import { Injectable, Logger } from "@nestjs/common";
import { documentTextSchema } from "@smart-lms/contracts";
import { Prisma } from "../generated/prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { LlmService } from "../llm/llm.service";
import { chunkDocument } from "./chunker";

/** Fragmentos que se mandan al modelo de embeddings en una sola llamada. */
const EMBED_BATCH = 32;

/** Documentos de un curso que se indexan de una vez al buscar (los que aún no tienen fragmentos). */
const ENSURE_LIMIT = 5;

/** `[0.1,0.2,…]`: el formato en que `pgvector` recibe un vector como texto. */
export const toVectorLiteral = (vector: number[]): string => `[${vector.join(",")}]`;

/**
 * Indexación de los documentos de un curso para la búsqueda (RF-14): divide el texto que extrajo el worker en
 * fragmentos, les calcula el embedding y los guarda en `document_chunks` con el curso, el documento y la página.
 * Reindexar un documento reemplaza sus fragmentos, así que es idempotente. Los fragmentos se borran en cascada
 * cuando se borra el documento (plazo de conservación de los sílabos).
 */
@Injectable()
export class DocumentIndexService {
  private readonly logger = new Logger(DocumentIndexService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Indexa un documento cuyo texto ya está extraído.
   *
   * @returns Cantidad de fragmentos guardados; 0 si el documento no existe o no tiene texto utilizable.
   */
  async indexDocument(documentId: string): Promise<number> {
    const document = await this.prisma.syllabusDocument.findUnique({
      where: { id: documentId },
      select: { id: true, moodleCourseId: true, extractedText: true, uploadedBy: true },
    });
    const text = documentTextSchema.safeParse(document?.extractedText);
    if (!document || !text.success) return 0;

    const chunks = chunkDocument(text.data.blocks);
    const embedded: { vector: number[]; model: string }[] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const result = await this.llm.embed({
        purpose: "rag_indexing",
        texts: batch.map((chunk) => chunk.content),
      });
      embedded.push(...result.vectors.map((vector) => ({ vector, model: result.model })));
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.documentChunk.deleteMany({ where: { documentId } });
      for (const [i, chunk] of chunks.entries()) {
        const { vector, model } = embedded[i]!;
        await tx.$executeRaw`
          INSERT INTO document_chunks (id, document_id, moodle_course_id, page, chunk_index, content, embedding, embedding_model)
          VALUES (gen_random_uuid(), ${documentId}::uuid, ${document.moodleCourseId}, ${chunk.page}, ${chunk.index},
                  ${chunk.content}, ${toVectorLiteral(vector)}::vector, ${model})`;
      }
    });

    await this.audit.record({
      action: "rag.indexed",
      outcome: "SUCCESS",
      actorMoodleId: document.uploadedBy,
      courseId: document.moodleCourseId,
      resourceType: "syllabus_document",
      resourceId: documentId,
      metadata: { chunks: chunks.length },
    });
    return chunks.length;
  }

  /** Indexa sin interrumpir a quien llama: un fallo se registra y el documento se indexará en la próxima búsqueda. */
  async indexDocumentSafely(documentId: string): Promise<void> {
    try {
      await this.indexDocument(documentId);
    } catch (error) {
      this.logger.warn(`No se pudo indexar el documento ${documentId}: ${String(error)}`);
    }
  }

  /**
   * Indexa los documentos del curso que ya tienen texto y todavía no tienen fragmentos del modelo actual (por ejemplo,
   * los que se cargaron antes de existir el índice, cuando el proveedor no respondía o con otro modelo). Es barato si no hay nada pendiente.
   */
  async ensureIndexed(courseId: number): Promise<void> {
    // Un documento indexado con otro modelo de embeddings (por ejemplo, el de demostración) vuelve a indexarse: los
    // vectores de modelos distintos no se pueden comparar.
    const model = this.llm.embeddingModel;
    if (!model) return;
    const pending = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT d.id
        FROM syllabus_documents d
       WHERE d.moodle_course_id = ${courseId}
         AND d.extracted_text IS NOT NULL
         AND d.status IN ('TEXT_READY', 'EXTRACTED', 'REVIEWED')
         AND NOT EXISTS (
               SELECT 1 FROM document_chunks c WHERE c.document_id = d.id AND c.embedding_model = ${model}
         )
       ORDER BY d.created_at DESC
       LIMIT ${ENSURE_LIMIT}`);
    for (const { id } of pending) await this.indexDocumentSafely(id);
  }
}
