import { randomBytes, randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { buildSyllabusExtraction } from "@smart-lms/contracts";
import request from "supertest";
import { AccessService } from "../src/auth/access.service";
import { InMemoryJtiStore, JtiStore } from "../src/auth/jti-store";
import { PrismaService } from "../src/database/prisma.service";
import type { CourseAccess } from "../src/integrations/moodle/moodle.types";
import { signPluginToken, TEST_ISSUER, TEST_SECRET } from "./support/plugin-token";

/**
 * Descarte de un sílabo contra PostgreSQL real: la cascada de extracciones, fragmentos y elementos de propuesta,
 * y que lo publicado lo bloquea. No corre por defecto, igual que proposals.db:
 *   RUN_DB_TESTS=1 DATABASE_URL=postgresql://... pnpm --filter @smart-lms/api exec jest syllabi-discard.db
 */
const describeWithDb =
  process.env.RUN_DB_TESTS === "1" && process.env.DATABASE_URL ? describe : describe.skip;

/** Curso propio de esta prueba, para no tocar datos de otras. */
const COURSE_ID = 90_008;

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

describeWithDb("Descarte de sílabos contra PostgreSQL real", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accountId: string;

  beforeAll(async () => {
    process.env.LOG_LEVEL = "fatal";
    process.env.PLUGIN_JWT_SECRET = TEST_SECRET;
    process.env.MOODLE_BASE_URL = TEST_ISSUER;
    const { AppModule } = await import("../src/app.module.js");
    const { configureApp } = await import("../src/app.setup.js");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JtiStore)
      .useValue(new InMemoryJtiStore())
      .overrideProvider(AccessService)
      .useValue(fakeAccess)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    const account = await prisma.integrationAccount.upsert({
      where: { moodleBaseUrl: TEST_ISSUER },
      update: {},
      create: { name: "Prueba", moodleBaseUrl: TEST_ISSUER, tokenSecretRef: "x", jwtKeyRef: "x" },
    });
    accountId = account.id;
  });

  afterAll(async () => {
    await prisma.publishOperation.deleteMany({
      where: { proposal: { moodleCourseId: COURSE_ID } },
    });
    await prisma.courseProposal.deleteMany({ where: { moodleCourseId: COURSE_ID } });
    await prisma.syllabusDocument.deleteMany({ where: { moodleCourseId: COURSE_ID } });
    await prisma.auditEvent.deleteMany({ where: { moodleCourseId: COURSE_ID } });
    await app.close();
  });

  const call = (method: "post" | "delete", path: string, body?: object) => {
    const req = request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set("Authorization", `Bearer ${signPluginToken({ courseid: COURSE_ID })}`);
    return body ? req.send(body) : req;
  };

  /** Sílabo revisado con dos versiones de la extracción, un fragmento indexado y una propuesta en revisión. */
  async function syllabusWithProposal(): Promise<{ documentId: string; proposalId: string }> {
    const document = await prisma.syllabusDocument.create({
      data: {
        integrationAccountId: accountId,
        moodleCourseId: COURSE_ID,
        uploadedBy: 42,
        filename: "silabo.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        checksumSha256: randomBytes(32).toString("hex"),
        status: "REVIEWED",
        retainUntil: new Date(Date.now() + 86_400_000),
      },
    });
    for (const [version, source] of [
      [1, "AI"],
      [2, "TEACHER"],
    ] as const) {
      await prisma.syllabusExtraction.create({
        data: {
          documentId: document.id,
          version,
          schemaVersion: "1.0",
          content: buildSyllabusExtraction() as object,
          source,
        },
      });
    }
    await prisma.documentChunk.create({
      data: {
        documentId: document.id,
        moodleCourseId: COURSE_ID,
        chunkIndex: 0,
        content: "Unidad 1",
      },
    });
    const proposal = await call("post", "/proposals", {
      syllabusId: document.id,
      extractionVersion: 2,
      confirmDuplicate: true,
    }).expect(201);
    return { documentId: document.id, proposalId: proposal.body.id };
  }

  it("borra el sílabo, sus extracciones, fragmentos, propuestas y elementos", async () => {
    const { documentId, proposalId } = await syllabusWithProposal();
    expect(await prisma.proposalItem.count({ where: { proposalId } })).toBeGreaterThan(0);

    await call("delete", `/syllabi/${documentId}`).expect(204);

    expect(await prisma.syllabusDocument.count({ where: { id: documentId } })).toBe(0);
    expect(await prisma.syllabusExtraction.count({ where: { documentId } })).toBe(0);
    expect(await prisma.documentChunk.count({ where: { documentId } })).toBe(0);
    expect(await prisma.courseProposal.count({ where: { id: proposalId } })).toBe(0);
    expect(await prisma.proposalItem.count({ where: { proposalId } })).toBe(0);
    expect(
      await prisma.auditEvent.count({
        where: { action: "syllabus.discard", resourceId: documentId },
      }),
    ).toBe(1);
    await call("delete", `/syllabi/${documentId}`).expect(404);
  });

  it("responde 409 y conserva todo si una propuesta tiene una operación de publicación", async () => {
    const { documentId, proposalId } = await syllabusWithProposal();
    await prisma.publishOperation.create({
      data: { proposalId, idempotencyKey: randomUUID(), requestedBy: 42, status: "FAILED" },
    });

    const response = await call("delete", `/syllabi/${documentId}`).expect(409);

    expect(response.body.code).toBe("SYLLABUS_PUBLISHED");
    expect(await prisma.syllabusDocument.count({ where: { id: documentId } })).toBe(1);
    expect(await prisma.courseProposal.count({ where: { id: proposalId } })).toBe(1);
    expect(await prisma.syllabusExtraction.count({ where: { documentId } })).toBe(2);
  });
});
