import { buildSyllabusExtraction, type DocumentText } from "@smart-lms/contracts";
import type { AuditService } from "../../audit/audit.service";
import type { PrismaService } from "../../database/prisma.service";
import { LlmService } from "../../llm/llm.service";
import { MockLlmProvider } from "../../llm/providers/mock-llm.provider";
import { SyllabusExtractionService } from "./syllabus-extraction.service";
import { SyllabusExtractorService } from "./syllabus-extractor.service";

const DOC_ID = "00000000-0000-4000-8000-000000000001";
const AUTH = { moodleUserId: 42, courseId: 7 };

const TEXT: DocumentText = {
  pageCount: 1,
  pagesApproximate: false,
  ocr: false,
  confidence: "high",
  blocks: [{ type: "paragraph", page: 1, text: "Ingeniería de Software" }],
};

interface Row {
  status: string;
  errorCode: string | null;
}

function setup(options: { status?: string; courseId?: number; responder?: () => unknown } = {}) {
  const document: Row & Record<string, unknown> = {
    id: DOC_ID,
    moodleCourseId: options.courseId ?? 7,
    filename: "silabo.pdf",
    status: options.status ?? "TEXT_READY",
    errorCode: null,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    pageCount: 1,
    extractedText: TEXT,
  };
  const versions: { version: number; source: string; content: unknown }[] = [];

  const delegate = {
    findUnique: jest.fn(async () => ({ ...document })),
    updateMany: jest.fn(
      async ({ where, data }: { where: { status?: unknown }; data: Partial<Row> }) => {
        const wanted = where.status;
        const allowed =
          typeof wanted === "string" ? [wanted] : ((wanted as { in?: string[] })?.in ?? null);
        // Una extracción atascada (OR) no se simula aquí: basta con los estados exactos.
        const orMatches = (where as { OR?: { status: unknown; updatedAt?: unknown }[] }).OR?.some(
          (clause) => {
            // La cláusula de extracción atascada exige un updatedAt antiguo; aquí nunca lo es.
            if (clause.updatedAt) return false;
            const s = clause.status;
            return typeof s === "string"
              ? s === document.status
              : (s as { in: string[] }).in.includes(document.status);
          },
        );
        const matches = orMatches ?? (allowed ? allowed.includes(document.status) : true);
        if (!matches) return { count: 0 };
        Object.assign(document, data);
        return { count: 1 };
      },
    ),
  };
  const extractionDelegate = {
    aggregate: jest.fn(async () => ({
      _max: { version: versions.length ? Math.max(...versions.map((v) => v.version)) : null },
    })),
    create: jest.fn(
      async ({ data }: { data: { version: number; source: string; content: unknown } }) => {
        const row = { ...data, schemaVersion: "1.0", consistencyIssues: [], createdAt: new Date() };
        versions.push(row);
        return row;
      },
    ),
    findFirst: jest.fn(async ({ where }: { where: { version?: number } }) => {
      const found = where.version
        ? versions.find((v) => v.version === where.version)
        : versions[versions.length - 1];
      return found
        ? { schemaVersion: "1.0", consistencyIssues: [], createdAt: new Date(), ...found }
        : null;
    }),
  };
  const prisma = {
    syllabusDocument: delegate,
    syllabusExtraction: extractionDelegate,
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({ syllabusDocument: delegate, syllabusExtraction: extractionDelegate }),
  };

  const provider = new MockLlmProvider(options.responder ?? (() => buildSyllabusExtraction()));
  const llm = new LlmService(
    provider,
    { record: () => undefined },
    {
      maxInputTokens: 32_000,
      maxOutputTokens: 8_192,
      timeoutMs: 5_000,
    },
  );
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new SyllabusExtractionService(
    prisma as unknown as PrismaService,
    new SyllabusExtractorService(llm),
    audit as unknown as AuditService,
  );
  return { service, document, versions, audit, provider };
}

describe("SyllabusExtractionService", () => {
  describe("start", () => {
    it("responde PROCESSING y termina en EXTRACTED con la versión 1 de la IA", async () => {
      const { service, document, versions, audit } = setup();

      const result = await service.start(AUTH, DOC_ID);

      expect(result.status).toBe("PROCESSING");
      await service.whenIdle();
      expect(document.status).toBe("EXTRACTED");
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({ version: 1, source: "AI" });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "syllabus.extraction", outcome: "SUCCESS" }),
      );
    });

    it("pasa a FAILED con el código del proveedor si la IA no responde", async () => {
      const { service, document, versions } = setup({
        responder: () => {
          throw new Error("sin red");
        },
      });

      await service.start(AUTH, DOC_ID);
      await service.whenIdle();

      expect(document.status).toBe("FAILED");
      expect(document.errorCode).toBe("AI_PROVIDER_UNAVAILABLE");
      expect(versions).toHaveLength(0);
    });

    it("pasa a FAILED con AI_INVALID_OUTPUT si la salida no cumple el esquema", async () => {
      const { service, document } = setup({ responder: () => ({ course: {} }) });

      await service.start(AUTH, DOC_ID);
      await service.whenIdle();

      expect(document.status).toBe("FAILED");
      expect(document.errorCode).toBe("AI_INVALID_OUTPUT");
    });

    it("permite reintentar desde FAILED", async () => {
      const { service, document } = setup({ status: "FAILED" });

      await service.start(AUTH, DOC_ID);
      await service.whenIdle();

      expect(document.status).toBe("EXTRACTED");
    });

    it.each(["UPLOADED", "PROCESSING", "REVIEWED", "REJECTED"])(
      "responde 409 si el sílabo está %s",
      async (status) => {
        const { service, provider } = setup({ status });

        await expect(service.start(AUTH, DOC_ID)).rejects.toMatchObject({
          response: { code: "INVALID_TRANSITION" },
        });
        expect(provider.calls).toHaveLength(0);
      },
    );

    it("responde 404 para un sílabo de otro curso o con un id inválido", async () => {
      const { service } = setup({ courseId: 99 });

      await expect(service.start(AUTH, DOC_ID)).rejects.toMatchObject({
        response: { code: "SYLLABUS_NOT_FOUND" },
      });
      await expect(service.start(AUTH, "no-es-uuid")).rejects.toMatchObject({
        response: { code: "SYLLABUS_NOT_FOUND" },
      });
    });

    it("no pisa la revisión del docente guardada mientras la IA trabajaba", async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const { service, document, versions } = setup({
        responder: async () => {
          await gate;
          return buildSyllabusExtraction();
        },
      });

      await service.start(AUTH, DOC_ID);
      // El docente guarda su revisión: el sílabo deja de estar PROCESSING.
      document.status = "REVIEWED";
      release();
      await service.whenIdle();

      expect(document.status).toBe("REVIEWED");
      expect(versions).toHaveLength(0);
    });
  });

  describe("saveRevision", () => {
    it("guarda una versión del docente, deja el sílabo REVIEWED y devuelve las advertencias", async () => {
      const { service, document, versions } = setup({ status: "EXTRACTED" });

      const result = await service.saveRevision(AUTH, DOC_ID, buildSyllabusExtraction());

      expect(document.status).toBe("REVIEWED");
      expect(versions[0]).toMatchObject({ version: 1, source: "TEACHER" });
      expect(result).toMatchObject({ version: 1, source: "TEACHER", schemaVersion: "1.0" });
      expect(result.consistencyIssues).toEqual(expect.any(Array));
    });

    it("numera las versiones en orden", async () => {
      const { service, versions } = setup({ status: "EXTRACTED" });

      await service.saveRevision(AUTH, DOC_ID, buildSyllabusExtraction());
      const second = await service.saveRevision(AUTH, DOC_ID, buildSyllabusExtraction());

      expect(second.version).toBe(2);
      expect(versions.map((v) => v.version)).toEqual([1, 2]);
    });

    it("responde 400 con details si el cuerpo no cumple el esquema, sin tocar el sílabo", async () => {
      const { service, document } = setup({ status: "EXTRACTED" });

      await expect(
        service.saveRevision(AUTH, DOC_ID, { schemaVersion: "1.0", course: { name: "" } }),
      ).rejects.toMatchObject({
        response: { code: "VALIDATION_ERROR", details: expect.any(Array) },
      });
      expect(document.status).toBe("EXTRACTED");
    });

    it.each(["UPLOADED", "PROCESSING"])("responde 409 si el sílabo está %s", async (status) => {
      const { service, versions } = setup({ status });

      await expect(
        service.saveRevision(AUTH, DOC_ID, buildSyllabusExtraction()),
      ).rejects.toMatchObject({ response: { code: "INVALID_TRANSITION" } });
      expect(versions).toHaveLength(0);
    });

    it("responde 409 si otra revisión ganó la misma versión", async () => {
      const { service } = setup({ status: "EXTRACTED" });
      const original = service as unknown as { prisma: { $transaction: unknown } };
      original.prisma.$transaction = async () => {
        throw Object.assign(new Error("duplicado"), { code: "P2002" });
      };

      await expect(
        service.saveRevision(AUTH, DOC_ID, buildSyllabusExtraction()),
      ).rejects.toMatchObject({ response: { code: "VERSION_CONFLICT" } });
    });
  });

  describe("get", () => {
    it("devuelve la última versión o la pedida", async () => {
      const { service } = setup({ status: "EXTRACTED" });
      await service.saveRevision(AUTH, DOC_ID, buildSyllabusExtraction());
      await service.saveRevision(AUTH, DOC_ID, buildSyllabusExtraction());

      expect((await service.get(AUTH, DOC_ID)).version).toBe(2);
      expect((await service.get(AUTH, DOC_ID, 1)).version).toBe(1);
    });

    it("responde 404 si todavía no hay extracción o la versión no existe", async () => {
      const { service } = setup();

      await expect(service.get(AUTH, DOC_ID)).rejects.toMatchObject({
        response: { code: "EXTRACTION_NOT_FOUND" },
      });
    });

    it("responde 404 para un sílabo de otro curso", async () => {
      const { service } = setup({ courseId: 99 });

      await expect(service.get(AUTH, DOC_ID)).rejects.toMatchObject({
        response: { code: "SYLLABUS_NOT_FOUND" },
      });
    });
  });
});
