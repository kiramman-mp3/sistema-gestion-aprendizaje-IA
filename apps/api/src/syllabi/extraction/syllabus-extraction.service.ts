import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
} from "@nestjs/common";
import {
  findConsistencyIssues,
  SYLLABUS_SCHEMA_VERSION,
  syllabusExtractionSchema,
} from "@smart-lms/contracts";
import { AuditService } from "../../audit/audit.service";
import type { AuthContext } from "../../auth/auth-context";
import { parseBody } from "../../common/parse-body";
import { PrismaService } from "../../database/prisma.service";
import { Prisma, type DocumentStatus } from "../../generated/prisma/client";
import { LlmError } from "../../llm/llm.errors";
import { toSyllabusDto, type SyllabusDocumentDto } from "../syllabus.dto";
import { toExtractionDto, type ExtractionVersionDto } from "./extraction.dto";
import { SyllabusExtractorService } from "./syllabus-extractor.service";

/** Estados desde los que se puede pedir la extracción (siempre con el texto ya extraído). */
const EXTRACTABLE: DocumentStatus[] = ["TEXT_READY", "EXTRACTED", "FAILED"];
/** Estados en los que el docente puede guardar su revisión. */
const REVIEWABLE: DocumentStatus[] = ["TEXT_READY", "EXTRACTED", "REVIEWED", "FAILED"];
/** Una extracción `PROCESSING` más antigua que esto se da por perdida (reinicio) y puede reintentarse. */
const STALE_PROCESSING_MS = 10 * 60 * 1000;

/** Código guardado cuando la extracción falla por algo que no es del proveedor de IA. */
export const GENERIC_EXTRACTION_ERROR = "EXTRACTION_FAILED";

/**
 * Flujo de la extracción con IA y de su revisión (RF-05, RF-06). El estado de negocio vive en
 * PostgreSQL: `TEXT_READY → PROCESSING → EXTRACTED | FAILED`, y `REVIEWED` cuando el docente guarda.
 * Cada resultado, de la IA o del docente, es una versión nueva e inmutable.
 */
@Injectable()
export class SyllabusExtractionService implements OnModuleDestroy {
  private readonly logger = new Logger(SyllabusExtractionService.name);
  private readonly running = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly extractor: SyllabusExtractorService,
    private readonly audit: AuditService,
  ) {}

  /** Marca el sílabo `PROCESSING` y lanza la extracción sin esperarla (responde 202). */
  async start(auth: AuthContext, id: string): Promise<SyllabusDocumentDto> {
    const document = await this.find(auth, id);
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);

    // La condición está en el UPDATE: dos peticiones a la vez no lanzan dos extracciones.
    const { count } = await this.prisma.syllabusDocument.updateMany({
      where: {
        id: document.id,
        // Sin texto extraído no hay nada que enviar al modelo.
        extractedText: { not: Prisma.DbNull },
        OR: [
          { status: { in: EXTRACTABLE } },
          { status: "PROCESSING", updatedAt: { lt: staleBefore } },
        ],
      },
      data: { status: "PROCESSING", errorCode: null },
    });
    if (count === 0) {
      throw new ConflictException({
        code: "INVALID_TRANSITION",
        message: "El sílabo no está listo para extraerse o ya se está procesando.",
      });
    }

    const task: Promise<void> = this.run(auth, document.id).finally(() =>
      this.running.delete(task),
    );
    this.running.add(task);
    return toSyllabusDto({ ...document, status: "PROCESSING", errorCode: null }, { progress: 0 });
  }

  /** Última versión de la extracción, o la indicada. */
  async get(auth: AuthContext, id: string, version?: number): Promise<ExtractionVersionDto> {
    const document = await this.find(auth, id);
    const row = await this.prisma.syllabusExtraction.findFirst({
      where: { documentId: document.id, ...(version ? { version } : {}) },
      orderBy: { version: "desc" },
    });
    if (!row) {
      throw new NotFoundException({
        code: "EXTRACTION_NOT_FOUND",
        message: "El sílabo todavía no tiene una extracción.",
      });
    }
    return toExtractionDto(row);
  }

  /** Guarda la revisión del docente como versión nueva y deja el sílabo en `REVIEWED`. */
  async saveRevision(auth: AuthContext, id: string, body: unknown): Promise<ExtractionVersionDto> {
    const content = parseBody(syllabusExtractionSchema, body);
    const document = await this.find(auth, id);
    if (!REVIEWABLE.includes(document.status)) {
      throw new ConflictException({
        code: "INVALID_TRANSITION",
        message: "El sílabo no admite una revisión en este momento.",
      });
    }

    const row = await this.prisma
      .$transaction(async (tx) => {
        // Solo se revisa un sílabo que sigue en un estado revisable: una extracción que empezó
        // entre tanto no se pisa.
        const { count } = await tx.syllabusDocument.updateMany({
          where: { id: document.id, status: { in: REVIEWABLE } },
          data: { status: "REVIEWED", errorCode: null },
        });
        if (count === 0) throw new StateChangedError();
        return tx.syllabusExtraction.create({
          data: {
            documentId: document.id,
            version: await nextVersion(tx, document.id),
            schemaVersion: SYLLABUS_SCHEMA_VERSION,
            content: content as unknown as Prisma.InputJsonValue,
            consistencyIssues: findConsistencyIssues(content) as unknown as Prisma.InputJsonValue,
            source: "TEACHER",
            createdBy: auth.moodleUserId,
          },
        });
      })
      .catch((error: unknown) => {
        // Dos revisiones a la vez calculan la misma versión; la segunda choca con la restricción única.
        if (error instanceof StateChangedError || isUniqueViolation(error)) {
          throw new ConflictException({
            code: "VERSION_CONFLICT",
            message:
              "El sílabo cambió mientras se guardaba. Vuelve a cargarlo e inténtalo de nuevo.",
          });
        }
        throw error;
      });

    await this.audit.record({
      action: "syllabus.extraction.review",
      outcome: "SUCCESS",
      actorMoodleId: auth.moodleUserId,
      courseId: auth.courseId,
      resourceType: "syllabus_document",
      resourceId: document.id,
      metadata: { version: row.version },
    });
    return toExtractionDto(row);
  }

  /** Espera a que terminen las extracciones en curso (cierre ordenado y pruebas). */
  async whenIdle(): Promise<void> {
    await Promise.all([...this.running]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.whenIdle();
  }

  private async run(auth: AuthContext, documentId: string): Promise<void> {
    try {
      const document = await this.prisma.syllabusDocument.findUnique({
        where: { id: documentId },
        select: { extractedText: true },
      });
      const result = await this.extractor.extract(document?.extractedText);

      await this.prisma.$transaction(async (tx) => {
        // Si el docente guardó su revisión mientras la IA trabajaba, no se pisa.
        const { count } = await tx.syllabusDocument.updateMany({
          where: { id: documentId, status: "PROCESSING" },
          data: { status: "EXTRACTED", errorCode: null },
        });
        if (count === 0) return;
        await tx.syllabusExtraction.create({
          data: {
            documentId,
            version: await nextVersion(tx, documentId),
            schemaVersion: SYLLABUS_SCHEMA_VERSION,
            content: result.extraction as unknown as Prisma.InputJsonValue,
            consistencyIssues: result.consistencyIssues as unknown as Prisma.InputJsonValue,
            source: "AI",
            llmModel: result.model,
          },
        });
      });
      await this.record(auth, documentId, "SUCCESS", {
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        droppedValues: result.droppedPaths.length,
      });
    } catch (error) {
      const errorCode = error instanceof LlmError ? error.code : GENERIC_EXTRACTION_ERROR;
      // Sin el mensaje: puede citar fragmentos del documento.
      this.logger.error(`La extracción del sílabo ${documentId} falló (${errorCode}).`);
      await this.prisma.syllabusDocument
        .updateMany({
          where: { id: documentId, status: "PROCESSING" },
          data: { status: "FAILED", errorCode },
        })
        .catch((updateError: unknown) =>
          this.logger.error(`No se pudo marcar el fallo de ${documentId}: ${String(updateError)}`),
        );
      await this.record(auth, documentId, "ERROR", { errorCode });
    }
  }

  private async record(
    auth: AuthContext,
    documentId: string,
    outcome: "SUCCESS" | "ERROR",
    metadata: Record<string, string | number>,
  ): Promise<void> {
    await this.audit
      .record({
        action: "syllabus.extraction",
        outcome,
        actorMoodleId: auth.moodleUserId,
        courseId: auth.courseId,
        resourceType: "syllabus_document",
        resourceId: documentId,
        metadata,
      })
      .catch((error: unknown) =>
        this.logger.error(`No se pudo auditar la extracción de ${documentId}: ${String(error)}`),
      );
  }

  /** Un sílabo de otro curso responde 404, igual que uno que no existe (RF-02). */
  private async find(auth: AuthContext, id: string) {
    const document = /^[0-9a-f-]{36}$/i.test(id)
      ? await this.prisma.syllabusDocument.findUnique({
          where: { id },
          select: {
            id: true,
            moodleCourseId: true,
            filename: true,
            status: true,
            errorCode: true,
            createdAt: true,
            pageCount: true,
          },
        })
      : null;
    if (!document || document.moodleCourseId !== auth.courseId) {
      throw new NotFoundException({ code: "SYLLABUS_NOT_FOUND", message: "El sílabo no existe." });
    }
    return document;
  }
}

class StateChangedError extends Error {}

async function nextVersion(tx: Prisma.TransactionClient, documentId: string): Promise<number> {
  const last = await tx.syllabusExtraction.aggregate({
    where: { documentId },
    _max: { version: true },
  });
  return (last._max.version ?? 0) + 1;
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002";
}
