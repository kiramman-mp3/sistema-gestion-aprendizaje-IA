import type { ConfigService } from "@nestjs/config";
import type { AntivirusService } from "../antivirus/antivirus.service";
import type { AuditService } from "../audit/audit.service";
import type { Env } from "../config/env";
import type { PrismaService } from "../database/prisma.service";
import type { IntegrationAccountService } from "../integrations/integration-account.service";
import type { FileStorage } from "../storage/file-storage";
import { minimalPdf } from "../../test/support/documents";
import { cleanFilename, SyllabiService } from "./syllabi.service";
import type { SyllabusProcessingService } from "./syllabus-processing.service";

describe("cleanFilename", () => {
  it("quita rutas y caracteres de control", () => {
    expect(cleanFilename("C:\\Users\\docente\\Sílabo.pdf", "pdf")).toBe("Sílabo.pdf");
    expect(cleanFilename("../../etc/silabo.pdf", "pdf")).toBe("silabo.pdf");
    expect(cleanFilename("si\u0000la\nbo.docx", "docx")).toBe("silabo.docx");
  });

  it("usa un nombre por defecto si no queda nada y conserva la extensión al recortar", () => {
    expect(cleanFilename("  \u0001 ", "pdf")).toBe("silabo.pdf");
    const long = `${"a".repeat(300)}.docx`;
    expect(cleanFilename(long, "docx")).toHaveLength(255);
    expect(cleanFilename(long, "docx").endsWith(".docx")).toBe(true);
  });
});

describe("SyllabiService", () => {
  it("borra el archivo guardado si falla el registro en la base", async () => {
    const storage = {
      put: jest.fn().mockResolvedValue("syllabi/00000000-0000-4000-8000-000000000001.pdf"),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const prisma = {
      syllabusDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(new Error("base caída")),
      },
    };
    const service = new SyllabiService(
      prisma as unknown as PrismaService,
      storage as unknown as FileStorage,
      { scan: async () => ({ status: "clean" }) } as unknown as AntivirusService,
      { record: jest.fn() } as unknown as AuditService,
      { currentId: async () => "cuenta-1" } as unknown as IntegrationAccountService,
      { get: () => 30 } as unknown as ConfigService<Env, true>,
      { enqueue: jest.fn() } as unknown as SyllabusProcessingService,
    );
    const content = minimalPdf();

    await expect(
      service.upload({ moodleUserId: 42, courseId: 7 }, 7, {
        originalname: "silabo.pdf",
        buffer: content,
        size: content.length,
      }),
    ).rejects.toThrow("base caída");
    expect(storage.delete).toHaveBeenCalledWith("syllabi/00000000-0000-4000-8000-000000000001.pdf");
  });
});

describe("SyllabiService.discard", () => {
  const ID = "00000000-0000-4000-8000-000000000009";
  const teacher = {
    moodleUserId: 42,
    courseId: 7,
    capabilities: { use: true, publish: true, viewanalytics: true, admin: false },
  };

  /** Base simulada: un sílabo del curso 7 con `proposals` propuestas, `published` de ellas ya publicadas. */
  function setup({ proposals = 1, published = 0, courseId = 7 } = {}) {
    const prisma = {
      syllabusDocument: {
        findUnique: jest.fn().mockResolvedValue({
          id: ID,
          moodleCourseId: courseId,
          storageKey: "syllabi/00000000-0000-4000-8000-000000000009.pdf",
          _count: { extractions: 2 },
        }),
        delete: jest.fn().mockResolvedValue({}),
      },
      courseProposal: {
        count: jest.fn(({ where }: { where: { OR?: unknown } }) =>
          Promise.resolve(where.OR ? published : proposals),
        ),
        deleteMany: jest.fn().mockResolvedValue({ count: proposals }),
      },
    };
    const db = Object.assign(prisma, {
      $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
        work(prisma),
      ),
    });
    const storage = { delete: jest.fn().mockResolvedValue(undefined) };
    const audit = { record: jest.fn() };
    const service = new SyllabiService(
      db as unknown as PrismaService,
      storage as unknown as FileStorage,
      {} as AntivirusService,
      audit as unknown as AuditService,
      {} as IntegrationAccountService,
      {} as ConfigService<Env, true>,
      {} as SyllabusProcessingService,
    );
    return { service, prisma: db, storage, audit };
  }

  it("borra las propuestas, el documento (con sus extracciones en cascada) y el archivo, y lo audita", async () => {
    const { service, prisma, storage, audit } = setup();

    await service.discard(teacher, ID);

    expect(prisma.courseProposal.deleteMany).toHaveBeenCalledWith({
      where: { extraction: { documentId: ID } },
    });
    expect(prisma.syllabusDocument.delete).toHaveBeenCalledWith({ where: { id: ID } });
    expect(storage.delete).toHaveBeenCalledWith("syllabi/00000000-0000-4000-8000-000000000009.pdf");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "syllabus.discard",
        outcome: "SUCCESS",
        resourceId: ID,
        metadata: { extractions: 2, proposals: 1 },
      }),
    );
  });

  it("responde 409 y no borra nada si una propuesta ya se publicó o empezó a publicarse", async () => {
    const { service, prisma, storage } = setup({ published: 1 });

    await expect(service.discard(teacher, ID)).rejects.toMatchObject({
      response: { code: "SYLLABUS_PUBLISHED" },
    });
    expect(prisma.courseProposal.deleteMany).not.toHaveBeenCalled();
    expect(prisma.syllabusDocument.delete).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("responde 409 si una publicación nueva bloquea el borrado (clave foránea)", async () => {
    const { service, prisma } = setup();
    prisma.courseProposal.deleteMany.mockRejectedValue(
      Object.assign(new Error("fk"), { code: "P2003" }),
    );

    await expect(service.discard(teacher, ID)).rejects.toMatchObject({
      response: { code: "SYLLABUS_PUBLISHED" },
    });
  });

  it("SEC-01: responde 404 para un sílabo de otro curso o un id inválido", async () => {
    const { service, prisma } = setup({ courseId: 8 });

    await expect(service.discard(teacher, ID)).rejects.toMatchObject({
      response: { code: "SYLLABUS_NOT_FOUND" },
    });
    await expect(service.discard(teacher, "no-es-un-uuid")).rejects.toMatchObject({
      response: { code: "SYLLABUS_NOT_FOUND" },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("exige publish para borrar propuestas, y lo audita como acceso denegado", async () => {
    const { service, prisma, audit } = setup();
    const withoutPublish = {
      ...teacher,
      capabilities: { ...teacher.capabilities, publish: false },
    };

    await expect(service.discard(withoutPublish, ID)).rejects.toMatchObject({
      response: { code: "FORBIDDEN_CAPABILITY" },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "access.denied", outcome: "DENIED" }),
    );
  });

  it("sin propuestas, descarta aunque falte publish", async () => {
    const { service, prisma } = setup({ proposals: 0 });
    const withoutPublish = {
      ...teacher,
      capabilities: { ...teacher.capabilities, publish: false },
    };

    await service.discard(withoutPublish, ID);

    expect(prisma.syllabusDocument.delete).toHaveBeenCalled();
  });

  it("si el archivo no se puede borrar, el descarte vale igual", async () => {
    const { service, storage, audit } = setup();
    storage.delete.mockRejectedValue(new Error("disco"));

    await expect(service.discard(teacher, ID)).resolves.toBeUndefined();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "syllabus.discard" }),
    );
  });
});
