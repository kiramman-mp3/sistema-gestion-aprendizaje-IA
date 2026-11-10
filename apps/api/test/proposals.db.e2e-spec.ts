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
 * Prueba contra PostgreSQL real: comprueba lo que la base en memoria de las demás pruebas no puede
 * (tipos Decimal y fecha, claves foráneas, cascada y la protección contra aprobaciones simultáneas).
 *
 * No corre por defecto, porque CI no tiene base. Para ejecutarla:
 *   RUN_DB_TESTS=1 DATABASE_URL=postgresql://... pnpm --filter @smart-lms/api exec jest proposals.db
 */
const describeWithDb =
  process.env.RUN_DB_TESTS === "1" && process.env.DATABASE_URL ? describe : describe.skip;

/** Curso propio de esta prueba, para no tocar datos de otras. */
const COURSE_ID = 90_007;

const fakeAccess = {
  getAccess: async (userId: number, courseId: number): Promise<CourseAccess> => ({
    userid: userId,
    courseid: courseId,
    courseexists: true,
    active: true,
    roles: ["editingteacher"],
    capabilities: { use: true, publish: true, viewanalytics: true },
  }),
};

describeWithDb("Propuestas contra PostgreSQL real", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let documentId: string;

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
    const document = await prisma.syllabusDocument.create({
      data: {
        integrationAccountId: account.id,
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
    documentId = document.id;
    await prisma.syllabusExtraction.create({
      data: {
        documentId,
        version: 1,
        schemaVersion: "1.0",
        content: buildSyllabusExtraction() as object,
        source: "TEACHER",
      },
    });
  });

  afterAll(async () => {
    // Las propuestas y sus elementos se borran en cascada con la extracción y el documento.
    await prisma.courseProposal.deleteMany({ where: { moodleCourseId: COURSE_ID } });
    await prisma.syllabusDocument.deleteMany({ where: { moodleCourseId: COURSE_ID } });
    await prisma.auditEvent.deleteMany({ where: { moodleCourseId: COURSE_ID } });
    await app.close();
  });

  const call = (method: "get" | "post" | "patch", path: string, body?: object) => {
    const req = request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set("Authorization", `Bearer ${signPluginToken({ courseid: COURSE_ID })}`);
    return body ? req.send(body) : req;
  };

  it("crea, lee, edita y aprueba una propuesta con los tipos reales de la base", async () => {
    const created = await call("post", "/proposals", {
      syllabusId: documentId,
      extractionVersion: 1,
      confirmDuplicate: true,
    }).expect(201);

    expect(created.body.status).toBe("NEEDS_REVIEW");
    expect(created.body.items[1]).toMatchObject({ weight: 30, dueDate: "2026-12-04" });

    const read = await call("get", `/proposals/${created.body.id}`).expect(200);
    expect(read.body).toEqual(created.body);

    const newId = randomUUID();
    const items = created.body.items.map((item: Record<string, unknown>) => ({ ...item }));
    items.splice(2, 0, {
      id: newId,
      parentId: items[0].id,
      itemType: "QUIZ",
      title: "Cuestionario",
      weight: 33.33,
      dueDate: "2026-12-10",
    });
    const edited = await call("patch", `/proposals/${created.body.id}`, { items }).expect(200);

    expect(edited.body.items.map((i: { id: string }) => i.id)).toContain(newId);
    expect(edited.body.items[2]).toMatchObject({ weight: 33.33, dueDate: "2026-12-10" });

    const approved = await call("post", `/proposals/${created.body.id}/approve`).expect(200);
    expect(approved.body).toMatchObject({ status: "APPROVED", approvedBy: 42 });

    const stored = await prisma.courseProposal.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    expect(stored.approvedAt).toBeInstanceOf(Date);
    expect(await prisma.proposalItem.count({ where: { proposalId: created.body.id } })).toBe(5);
  });

  it("dos aprobaciones simultáneas: solo una se aplica", async () => {
    const created = await call("post", "/proposals", {
      syllabusId: documentId,
      extractionVersion: 1,
      confirmDuplicate: true,
    }).expect(201);

    const results = await Promise.all([
      call("post", `/proposals/${created.body.id}/approve`),
      call("post", `/proposals/${created.body.id}/approve`),
      call("post", `/proposals/${created.body.id}/approve`),
    ]);

    const statuses = results.map((res) => res.status).sort();
    expect(statuses).toEqual([200, 409, 409]);
    expect(
      results
        .filter((res) => res.status === 409)
        .every((res) => ["INVALID_TRANSITION", "PROPOSAL_CHANGED"].includes(res.body.code)),
    ).toBe(true);
  });

  it("la edición reemplaza los elementos sin dejar huérfanos", async () => {
    const created = await call("post", "/proposals", {
      syllabusId: documentId,
      extractionVersion: 1,
      confirmDuplicate: true,
    }).expect(201);
    const [section] = created.body.items;

    await call("patch", `/proposals/${created.body.id}`, {
      items: [{ id: section.id, itemType: "SECTION", title: "Solo esta" }],
    }).expect(200);

    expect(await prisma.proposalItem.count({ where: { proposalId: created.body.id } })).toBe(1);
  });
});
