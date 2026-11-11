import type { AuditService } from "../audit/audit.service";
import type { PrismaService } from "../database/prisma.service";
import type { DocumentIndexService } from "../rag/document-index.service";
import { DocumentTextResultsHandler, GENERIC_TEXT_ERROR } from "./document-text-results.handler";

const DOCUMENT_ID = "0b6f3c8e-2a7d-4f43-9b1a-6f8e2d3c4b5a";

const validText = {
  pageCount: 1,
  pagesApproximate: false,
  ocr: false,
  confidence: "high",
  blocks: [{ type: "paragraph", page: 1, text: "Unidad 1" }],
};

function setup(updatedCount = 1) {
  const updateMany = jest.fn().mockResolvedValue({ count: updatedCount });
  const record = jest.fn();
  const indexDocumentSafely = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    syllabusDocument: {
      updateMany,
      findUnique: jest.fn().mockResolvedValue({ moodleCourseId: 2, uploadedBy: 4 }),
    },
  } as unknown as PrismaService;
  const handler = new DocumentTextResultsHandler(
    prisma,
    { record } as unknown as AuditService,
    { indexDocumentSafely } as unknown as DocumentIndexService,
  );
  return { handler, updateMany, record, indexDocumentSafely };
}

describe("DocumentTextResultsHandler", () => {
  it("al dejar el texto listo pide indexar el documento para la búsqueda", async () => {
    const { handler, indexDocumentSafely } = setup();

    await handler.handle(DOCUMENT_ID, { value: validText });

    expect(indexDocumentSafely).toHaveBeenCalledWith(DOCUMENT_ID);
  });

  it("si el documento no estaba en proceso (trabajo repetido), no lo indexa de nuevo", async () => {
    const { handler, indexDocumentSafely } = setup(0);

    await handler.handle(DOCUMENT_ID, { value: validText });

    expect(indexDocumentSafely).not.toHaveBeenCalled();
  });

  it("si el worker falla, no indexa nada", async () => {
    const { handler, indexDocumentSafely } = setup();

    await handler.handle(DOCUMENT_ID, { failedReason: "ENCRYPTED_DOCUMENT" });

    expect(indexDocumentSafely).not.toHaveBeenCalled();
  });

  it("guarda el texto válido y marca el documento TEXT_READY", async () => {
    const { handler, updateMany, record } = setup();
    await handler.handle(DOCUMENT_ID, { value: validText });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: DOCUMENT_ID, status: "PROCESSING" },
      data: expect.objectContaining({
        status: "TEXT_READY",
        extractedText: validText,
        pageCount: 1,
        errorCode: null,
      }),
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "syllabus.text_extracted",
        outcome: "SUCCESS",
        actorMoodleId: 4,
        courseId: 2,
        metadata: { blocks: 1, ocr: false, confidence: "high" },
      }),
    );
  });

  it("no audita de nuevo si el documento ya no estaba en proceso", async () => {
    const { handler, record } = setup(0);
    await handler.handle(DOCUMENT_ID, { value: validText });
    expect(record).not.toHaveBeenCalled();
  });

  it("guarda el código de error conocido que informa el worker", async () => {
    const { handler, updateMany } = setup();
    await handler.handle(DOCUMENT_ID, { failedReason: "ENCRYPTED_DOCUMENT" });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "FAILED", errorCode: "ENCRYPTED_DOCUMENT" } }),
    );
  });

  it("no expone mensajes internos: un error desconocido se guarda con un código genérico", async () => {
    const { handler, updateMany } = setup();
    await handler.handle(DOCUMENT_ID, { failedReason: "ENOENT: /var/lib/smart-lms/storage/x" });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "FAILED", errorCode: GENERIC_TEXT_ERROR } }),
    );
  });

  it("rechaza un resultado del worker que no cumple el contrato", async () => {
    const { handler, updateMany } = setup();
    await handler.handle(DOCUMENT_ID, { value: { blocks: "no es una lista" } });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "FAILED", errorCode: "INVALID_WORKER_RESULT" } }),
    );
  });
});
