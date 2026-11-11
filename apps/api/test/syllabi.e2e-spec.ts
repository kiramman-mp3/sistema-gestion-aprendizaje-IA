import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AntivirusService, type ScanVerdict } from "../src/antivirus/antivirus.service";
import { AntivirusUnavailableError } from "../src/antivirus/clamav.client";
import { AuditService, type AuditEntry } from "../src/audit/audit.service";
import { AccessService } from "../src/auth/access.service";
import { InMemoryJtiStore, JtiStore } from "../src/auth/jti-store";
import { PrismaService } from "../src/database/prisma.service";
import type { CourseAccess } from "../src/integrations/moodle/moodle.types";
import { MAX_SYLLABUS_BYTES } from "../src/syllabi/syllabi.service";
import { SyllabusProcessingService } from "../src/syllabi/syllabus-processing.service";
import { minimalDocx, minimalPdf } from "./support/documents";
import { signPluginToken, TEST_ISSUER, TEST_SECRET } from "./support/plugin-token";

/** Moodle simulado: el usuario 42 es docente del curso 7. */
const fakeAccess = {
  getAccess: async (userId: number, courseId: number): Promise<CourseAccess> => ({
    userid: userId,
    courseid: courseId,
    courseexists: true,
    active: true,
    roles: ["editingteacher"],
    capabilities: { use: true, publish: true, viewanalytics: true, admin: false },
  }),
};

interface StoredDocument {
  id: string;
  moodleCourseId: number;
  checksumSha256: string;
  status: string;
  [key: string]: unknown;
}

/** Tabla de documentos en memoria, con lo justo que usa SyllabiService. */
function fakePrisma(documents: StoredDocument[]) {
  return {
    integrationAccount: { upsert: async () => ({ id: "cuenta-1" }) },
    syllabusDocument: {
      findFirst: async ({ where }: { where: Partial<StoredDocument> }) => {
        // Sin suma de verificación es la consulta del «más reciente del curso»: el último que se cargó.
        if (where.checksumSha256 === undefined) {
          return documents.filter((d) => d.moodleCourseId === where.moodleCourseId).at(-1) ?? null;
        }
        return (
          documents.find(
            (d) =>
              d.moodleCourseId === where.moodleCourseId &&
              d.checksumSha256 === where.checksumSha256 &&
              !["REJECTED", "FAILED"].includes(d.status),
          ) ?? null
        );
      },
      create: async ({
        data,
      }: {
        data: Pick<StoredDocument, "moodleCourseId" | "checksumSha256">;
      }) => {
        const document: StoredDocument = {
          ...data,
          id: `00000000-0000-4000-8000-${String(documents.length + 1).padStart(12, "0")}`,
          status: "UPLOADED",
          errorCode: null,
          createdAt: new Date("2026-11-09T12:00:00Z"),
        };
        documents.push(document);
        return document;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const document = documents.find((d) => d.id === where.id);
        return document ? { ...document, extractions: [] } : null;
      },
    },
  };
}

describe("Carga de sílabos (e2e)", () => {
  let app: INestApplication;
  let storageDir: string;
  const audit: AuditEntry[] = [];
  const documents: StoredDocument[] = [];
  const enqueued: unknown[] = [];
  let scan: (content: Buffer) => Promise<ScanVerdict>;

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), "smart-lms-e2e-"));
    process.env.LOG_LEVEL = "fatal";
    process.env.PLUGIN_JWT_SECRET = TEST_SECRET;
    process.env.MOODLE_BASE_URL = TEST_ISSUER;
    process.env.STORAGE_DIR = storageDir;
    // ConfigModule valida el entorno al importar AppModule: se importa después de definirlo.
    const { AppModule } = await import("../src/app.module.js");
    const { configureApp } = await import("../src/app.setup.js");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JtiStore)
      .useValue(new InMemoryJtiStore())
      .overrideProvider(AccessService)
      .useValue(fakeAccess)
      .overrideProvider(AuditService)
      .useValue({ record: async (entry: AuditEntry) => void audit.push(entry) })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma(documents))
      .overrideProvider(AntivirusService)
      .useValue({ enabled: true, scan: (content: Buffer) => scan(content) })
      .overrideProvider(SyllabusProcessingService)
      .useValue({
        enqueue: async (job: { documentId: string }) => {
          enqueued.push(job);
          const document = documents.find((d) => d.id === job.documentId);
          if (document) document.status = "PROCESSING";
          return true;
        },
        progress: async () => 40,
      })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    scan = async () => ({ status: "clean" });
  });

  afterAll(async () => {
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
    delete process.env.STORAGE_DIR;
  });

  const upload = (content: Buffer, filename: string, courseId: string | number = 7) =>
    request(app.getHttpServer())
      .post("/api/v1/syllabi")
      .set("Authorization", `Bearer ${signPluginToken()}`)
      .field("courseId", String(courseId))
      .attach("file", content, { filename, contentType: "application/octet-stream" });

  const storedFiles = async () => readdir(join(storageDir, "syllabi")).catch(() => []);

  it("acepta un PDF, lo guarda y lo audita (FUN-01)", async () => {
    const res = await upload(minimalPdf("Ingenieria de Software"), "Sílabo IS-501.pdf").expect(202);
    expect(res.body).toMatchObject({
      courseId: 7,
      filename: "Sílabo IS-501.pdf",
      status: "PROCESSING",
      progress: 0,
      errorCode: null,
    });
    expect(enqueued.at(-1)).toEqual({
      documentId: res.body.id,
      storageKey: documents.at(-1)?.storageKey,
      kind: "pdf",
    });
    expect(documents.at(-1)).toMatchObject({
      mimeType: "application/pdf",
      uploadedBy: 42,
      integrationAccountId: "cuenta-1",
      storageKey: expect.stringMatching(/^syllabi\/[0-9a-f-]{36}\.pdf$/),
    });
    expect(await storedFiles()).toHaveLength(1);
    expect(audit).toContainEqual(
      expect.objectContaining({ action: "syllabus.upload", outcome: "SUCCESS", courseId: 7 }),
    );
  });

  it("acepta un DOCX", async () => {
    const res = await upload(minimalDocx("Bases de datos"), "silabo-bd.docx").expect(202);
    expect(res.body.status).toBe("PROCESSING");
  });

  it("rechaza la misma carga en el mismo curso con 409", async () => {
    const content = minimalPdf("Duplicado");
    const first = await upload(content, "a.pdf").expect(202);
    const res = await upload(content, "b.pdf").expect(409);
    expect(res.body).toMatchObject({
      code: "DUPLICATE_SYLLABUS",
      details: [{ path: "syllabusId", message: first.body.id }],
    });
  });

  it("FUN-02: rechaza un archivo con extensión falsa sin guardarlo", async () => {
    const before = (await storedFiles()).length;
    const res = await upload(Buffer.from("MZ\x90\x00 no soy un pdf"), "silabo.pdf").expect(415);
    expect(res.body.code).toBe("MIME_MISMATCH");
    expect(await storedFiles()).toHaveLength(before);
    expect(audit).toContainEqual(
      expect.objectContaining({
        action: "syllabus.rejected",
        outcome: "DENIED",
        metadata: { reason: "MIME_MISMATCH" },
      }),
    );
  });

  it("rechaza extensiones no permitidas", async () => {
    const res = await upload(minimalPdf(), "silabo.txt").expect(415);
    expect(res.body.code).toBe("EXTENSION_NOT_ALLOWED");
  });

  it("SEC-05: rechaza y audita un archivo con malware", async () => {
    scan = async () => ({ status: "infected", signature: "Eicar-Test-Signature" });
    const before = (await storedFiles()).length;
    const res = await upload(minimalPdf("eicar"), "silabo.pdf").expect(422);
    expect(res.body.code).toBe("MALWARE_DETECTED");
    expect(await storedFiles()).toHaveLength(before);
    expect(audit).toContainEqual(
      expect.objectContaining({
        action: "syllabus.rejected",
        metadata: { reason: "MALWARE_DETECTED", signature: "Eicar-Test-Signature" },
      }),
    );
  });

  it("falla cerrado con 503 si el antivirus no responde", async () => {
    scan = async () => {
      throw new AntivirusUnavailableError("sin clamd");
    };
    const res = await upload(minimalPdf("sin antivirus"), "silabo.pdf").expect(503);
    expect(res.body.code).toBe("ANTIVIRUS_UNAVAILABLE");
  });

  it("responde 413 si el archivo supera 10 MB", async () => {
    const big = Buffer.concat([minimalPdf(), Buffer.alloc(MAX_SYLLABUS_BYTES)]);
    const res = await upload(big, "grande.pdf").expect(413);
    expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("exige el archivo", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/syllabi")
      .set("Authorization", `Bearer ${signPluginToken()}`)
      .field("courseId", "7")
      .expect(400);
    expect(res.body.code).toBe("FILE_REQUIRED");
  });

  it("SEC-01: rechaza un curso distinto al del token", async () => {
    const res = await upload(minimalPdf("otro curso"), "silabo.pdf", 8).expect(403);
    expect(res.body.code).toBe("FORBIDDEN_COURSE");
    await upload(minimalPdf("sin curso"), "silabo.pdf", "abc").expect(403);
  });

  it("SEC-03: rechaza la carga sin token", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/syllabi")
      .field("courseId", "7")
      .attach("file", minimalPdf(), "silabo.pdf")
      .expect(401);
  });

  describe("GET /syllabi/:id", () => {
    const get = (id: string, courseid = 7) =>
      request(app.getHttpServer())
        .get(`/api/v1/syllabi/${id}`)
        .set("Authorization", `Bearer ${signPluginToken({ courseid })}`);

    it("devuelve el estado y el progreso del worker (RF-04)", async () => {
      const uploaded = await upload(minimalPdf("estado"), "estado.pdf").expect(202);
      const res = await get(uploaded.body.id).expect(200);
      expect(res.body).toMatchObject({
        id: uploaded.body.id,
        status: "PROCESSING",
        progress: 40,
        pageCount: null,
        textConfidence: null,
        latestExtractionVersion: null,
      });
    });

    it("SEC-01: responde 404 para un sílabo de otro curso sin revelar que existe", async () => {
      const uploaded = await upload(minimalPdf("ajeno"), "ajeno.pdf").expect(202);
      const res = await get(uploaded.body.id, 8).expect(404);
      expect(res.body.code).toBe("SYLLABUS_NOT_FOUND");
      await get("no-es-un-uuid").expect(404);
      await get("00000000-0000-4000-8000-999999999999").expect(404);
    });
  });

  describe("GET /syllabi/latest", () => {
    const latest = (courseid = 7) =>
      request(app.getHttpServer())
        .get("/api/v1/syllabi/latest")
        .set("Authorization", `Bearer ${signPluginToken({ courseid })}`);

    it("devuelve el último sílabo cargado en el curso del token, para retomarlo al abrir la página", async () => {
      await upload(minimalPdf("primero"), "primero.pdf").expect(202);
      const second = await upload(minimalPdf("segundo"), "segundo.pdf").expect(202);

      const res = await latest().expect(200);

      expect(res.body).toMatchObject({ id: second.body.id, status: "PROCESSING" });
    });

    it("SEC-01: no devuelve sílabos de otro curso", async () => {
      await upload(minimalPdf("curso siete"), "siete.pdf").expect(202);

      // El curso 8 no tiene ninguno: responde 404 aunque el 7 tenga varios.
      const res = await latest(8).expect(404);

      expect(res.body.code).toBe("SYLLABUS_NOT_FOUND");
    });

    it("SEC-03: exige el token", async () => {
      await request(app.getHttpServer()).get("/api/v1/syllabi/latest").expect(401);
    });
  });
});
