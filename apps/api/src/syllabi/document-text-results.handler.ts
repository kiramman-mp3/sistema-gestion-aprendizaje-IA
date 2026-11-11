import { Injectable, Logger } from "@nestjs/common";
import { DOCUMENT_TEXT_ERROR_CODES, documentTextSchema } from "@smart-lms/contracts";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { DocumentIndexService } from "../rag/document-index.service";

/** Código guardado cuando el worker falla por una causa que no está en el contrato. */
export const GENERIC_TEXT_ERROR = "TEXT_EXTRACTION_FAILED";
const KNOWN_ERRORS = new Set<string>(DOCUMENT_TEXT_ERROR_CODES);

export interface ChildOutcome {
  /** Valor devuelto por el worker, si terminó bien. */
  value?: unknown;
  /** Motivo del último fallo, si agotó los reintentos. */
  failedReason?: string;
}

/**
 * Guarda en PostgreSQL lo que devolvió el worker documental. El resultado se valida contra el
 * contrato: el worker procesa archivos no confiables y su salida tampoco se da por buena.
 */
@Injectable()
export class DocumentTextResultsHandler {
  private readonly logger = new Logger(DocumentTextResultsHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly index: DocumentIndexService,
  ) {}

  async handle(documentId: string, outcome: ChildOutcome): Promise<void> {
    const parsed =
      outcome.value === undefined ? undefined : documentTextSchema.safeParse(outcome.value);

    if (parsed?.success) {
      // Solo se actualiza un documento en proceso: repetir el trabajo no cambia nada.
      const { count } = await this.prisma.syllabusDocument.updateMany({
        where: { id: documentId, status: "PROCESSING" },
        data: {
          status: "TEXT_READY",
          extractedText: parsed.data,
          pageCount: parsed.data.pageCount,
          textExtractedAt: new Date(),
          errorCode: null,
        },
      });
      if (count > 0) {
        await this.record(documentId, "SUCCESS", {
          blocks: parsed.data.blocks.length,
          ocr: parsed.data.ocr,
          confidence: parsed.data.confidence,
        });
        // La indexación para la búsqueda no retrasa ni hace fallar el procesamiento del documento (RF-14).
        void this.index.indexDocumentSafely(documentId);
      }
      return;
    }

    if (parsed && !parsed.success) {
      this.logger.error(`El worker devolvió un resultado inválido para ${documentId}.`);
    }
    const reason = outcome.failedReason?.trim() ?? "";
    const errorCode = parsed
      ? "INVALID_WORKER_RESULT"
      : KNOWN_ERRORS.has(reason)
        ? reason
        : GENERIC_TEXT_ERROR;
    const { count } = await this.prisma.syllabusDocument.updateMany({
      where: { id: documentId, status: "PROCESSING" },
      data: { status: "FAILED", errorCode },
    });
    if (count > 0) await this.record(documentId, "ERROR", { errorCode });
  }

  private async record(
    documentId: string,
    outcome: "SUCCESS" | "ERROR",
    metadata: Record<string, string | number | boolean>,
  ): Promise<void> {
    const document = await this.prisma.syllabusDocument.findUnique({
      where: { id: documentId },
      select: { moodleCourseId: true, uploadedBy: true },
    });
    await this.audit.record({
      action: "syllabus.text_extracted",
      outcome,
      actorMoodleId: document?.uploadedBy,
      courseId: document?.moodleCourseId,
      resourceType: "syllabus_document",
      resourceId: documentId,
      metadata,
    });
  }
}
