import { Injectable, Logger } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileStorage } from "../storage/file-storage";
import { SyllabusProcessingService } from "../syllabi/syllabus-processing.service";

/** Un sílabo `UPLOADED` más viejo que esto no se pudo encolar al subirlo (Redis caído). */
export const STALLED_UPLOAD_MS = 2 * 60 * 1000;
/** Máximo de documentos por ejecución, para que una tarea no ocupe la base mucho tiempo. */
const BATCH_SIZE = 100;

/**
 * Tareas periódicas sobre los sílabos: borrar los originales vencidos (RNF-08) y volver a encolar los
 * que quedaron sin procesar. Ambas son idempotentes: repetirlas no cambia el resultado.
 */
@Injectable()
export class SyllabusMaintenanceService {
  private readonly logger = new Logger(SyllabusMaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorage,
    private readonly processing: SyllabusProcessingService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Borra el archivo original de los sílabos cuya retención venció. La fila y el texto extraído se
   * conservan: el docente sigue viendo su sílabo, pero el archivo subido ya no existe.
   */
  async purgeExpiredFiles(now = new Date()): Promise<number> {
    const expired = await this.prisma.syllabusDocument.findMany({
      where: { retainUntil: { lt: now }, storageKey: { not: null } },
      select: { id: true, storageKey: true, moodleCourseId: true },
      take: BATCH_SIZE,
    });
    for (const document of expired) {
      await this.storage.delete(document.storageKey!);
      await this.prisma.syllabusDocument.update({
        where: { id: document.id },
        data: { storageKey: null },
      });
      await this.audit.record({
        action: "syllabus.file_purged",
        outcome: "SUCCESS",
        courseId: document.moodleCourseId,
        resourceType: "syllabus_document",
        resourceId: document.id,
      });
    }
    if (expired.length > 0) this.logger.log(`Archivos vencidos borrados: ${expired.length}.`);
    return expired.length;
  }

  /** Vuelve a encolar los sílabos que no se encolaron al subirlos. */
  async requeueStalledUploads(now = new Date()): Promise<number> {
    const stalled = await this.prisma.syllabusDocument.findMany({
      where: {
        status: "UPLOADED",
        storageKey: { not: null },
        createdAt: { lt: new Date(now.getTime() - STALLED_UPLOAD_MS) },
      },
      select: { id: true, storageKey: true, mimeType: true },
      take: BATCH_SIZE,
    });
    let enqueued = 0;
    for (const document of stalled) {
      const kind = document.mimeType === "application/pdf" ? "pdf" : "docx";
      const ok = await this.processing.enqueue({
        documentId: document.id,
        storageKey: document.storageKey!,
        kind,
      });
      if (ok) enqueued++;
    }
    if (enqueued > 0) this.logger.log(`Sílabos encolados de nuevo: ${enqueued}.`);
    return enqueued;
  }
}
