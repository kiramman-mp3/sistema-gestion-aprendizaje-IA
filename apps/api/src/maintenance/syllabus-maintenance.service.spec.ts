import type { AuditService } from "../audit/audit.service";
import type { PrismaService } from "../database/prisma.service";
import type { FileStorage } from "../storage/file-storage";
import type { SyllabusProcessingService } from "../syllabi/syllabus-processing.service";
import { STALLED_UPLOAD_MS, SyllabusMaintenanceService } from "./syllabus-maintenance.service";

const NOW = new Date("2026-12-10T03:00:00Z");

function setup(rows: object[], enqueueResult = true) {
  const prisma = {
    syllabusDocument: {
      findMany: jest.fn().mockResolvedValue(rows),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const storage = { delete: jest.fn().mockResolvedValue(undefined) };
  const processing = { enqueue: jest.fn().mockResolvedValue(enqueueResult) };
  const audit = { record: jest.fn() };
  const service = new SyllabusMaintenanceService(
    prisma as unknown as PrismaService,
    storage as unknown as FileStorage,
    processing as unknown as SyllabusProcessingService,
    audit as unknown as AuditService,
  );
  return { service, prisma, storage, processing, audit };
}

describe("SyllabusMaintenanceService", () => {
  it("borra los archivos vencidos y conserva la fila sin clave de almacenamiento", async () => {
    const { service, prisma, storage, audit } = setup([
      { id: "doc-1", storageKey: "syllabi/a.pdf", moodleCourseId: 2 },
    ]);

    await expect(service.purgeExpiredFiles(NOW)).resolves.toBe(1);
    expect(prisma.syllabusDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { retainUntil: { lt: NOW }, storageKey: { not: null } } }),
    );
    expect(storage.delete).toHaveBeenCalledWith("syllabi/a.pdf");
    expect(prisma.syllabusDocument.update).toHaveBeenCalledWith({
      where: { id: "doc-1" },
      data: { storageKey: null },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "syllabus.file_purged", resourceId: "doc-1" }),
    );
  });

  it("vuelve a encolar los sílabos que quedaron sin procesar", async () => {
    const { service, prisma, processing } = setup([
      { id: "doc-1", storageKey: "syllabi/a.pdf", mimeType: "application/pdf" },
      { id: "doc-2", storageKey: "syllabi/b.docx", mimeType: "application/vnd.openxmlformats" },
    ]);

    await expect(service.requeueStalledUploads(NOW)).resolves.toBe(2);
    expect(prisma.syllabusDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "UPLOADED",
          storageKey: { not: null },
          createdAt: { lt: new Date(NOW.getTime() - STALLED_UPLOAD_MS) },
        },
      }),
    );
    expect(processing.enqueue).toHaveBeenNthCalledWith(2, {
      documentId: "doc-2",
      storageKey: "syllabi/b.docx",
      kind: "docx",
    });
  });

  it("no cuenta los que no se pudieron encolar", async () => {
    const { service } = setup(
      [{ id: "doc-1", storageKey: "syllabi/a.pdf", mimeType: "application/pdf" }],
      false,
    );
    await expect(service.requeueStalledUploads(NOW)).resolves.toBe(0);
  });
});
