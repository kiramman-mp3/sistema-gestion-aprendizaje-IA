import { randomBytes, randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { buildSyllabusExtraction } from "@smart-lms/contracts";
import request from "supertest";
import { AccessService } from "../src/auth/access.service";
import { InMemoryJtiStore, JtiStore } from "../src/auth/jti-store";
import { PrismaService } from "../src/database/prisma.service";
import { MoodleService } from "../src/integrations/moodle/moodle.service";
import type { CourseAccess } from "../src/integrations/moodle/moodle.types";
import { ProposalPublisher } from "../src/proposals/proposal-publisher";
import { PublishDispatcher } from "../src/proposals/publish-dispatcher";
import { FakeMoodle } from "./support/fake-moodle";
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
    capabilities: { use: true, publish: true, viewanalytics: true, admin: false },
  }),
};

describeWithDb("Propuestas contra PostgreSQL real", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let documentId: string;
  const moodle = new FakeMoodle();

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
      .overrideProvider(MoodleService)
      .useValue(moodle)
      .overrideProvider(PublishDispatcher)
      .useFactory({
        inject: [ProposalPublisher],
        factory: (publisher: ProposalPublisher) => ({
          dispatch: (operationId: string) => publisher.run(operationId),
        }),
      })
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
    await prisma.activityUnitMapping.deleteMany({ where: { moodleCourseId: COURSE_ID } });
    await prisma.publishOperation.deleteMany({
      where: { proposal: { moodleCourseId: COURSE_ID } },
    });
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

  describe("publicación", () => {
    beforeEach(() => moodle.reset());

    const approved = async () => {
      const created = await call("post", "/proposals", {
        syllabusId: documentId,
        extractionVersion: 1,
        confirmDuplicate: true,
      }).expect(201);
      await call("post", `/proposals/${created.body.id}/approve`).expect(200);
      return created.body as { id: string };
    };

    const publish = (proposalId: string, key: string) =>
      request(app.getHttpServer())
        .post(`/api/v1/proposals/${proposalId}/publish`)
        .set("Authorization", `Bearer ${signPluginToken({ courseid: COURSE_ID })}`)
        .set("Idempotency-Key", key)
        .send({ confirm: true });

    it("publica y guarda el id de Moodle de cada elemento", async () => {
      const proposal = await approved();

      const started = await publish(proposal.id, `clave-real-${randomUUID()}`).expect(202);

      const stored = await prisma.courseProposal.findUniqueOrThrow({
        where: { id: proposal.id },
        include: { items: true, publishOperations: true },
      });
      expect(stored.status).toBe("PUBLISHED");
      expect(stored.publishedAt).toBeInstanceOf(Date);
      expect(
        stored.items.every((item) => item.publishStatus === "CREATED" && item.moodleItemId),
      ).toBe(true);
      // Las actividades creadas quedan relacionadas con su unidad (y repetir no las duplica).
      const mappings = await prisma.activityUnitMapping.findMany({
        where: { moodleCourseId: COURSE_ID },
      });
      expect(mappings.map((m) => [m.unitRef, m.source]).sort()).toEqual([
        ["gradingPeriods[0].units[0]", "PROPOSAL"],
        ["gradingPeriods[1].units[0]", "PROPOSAL"],
      ]);
      expect(stored.publishOperations).toMatchObject([
        { id: started.body.id, status: "SUCCEEDED", createdCount: 4, failedCount: 0 },
      ]);
    });

    it("tres peticiones simultáneas con la misma clave crean una sola operación (índice único real)", async () => {
      const proposal = await approved();
      const key = `clave-real-${randomUUID()}`;

      const results = await Promise.all([
        publish(proposal.id, key),
        publish(proposal.id, key),
        publish(proposal.id, key),
      ]);

      expect(results.map((res) => res.status)).toEqual([202, 202, 202]);
      expect(new Set(results.map((res) => res.body.id)).size).toBe(1);
      expect(await prisma.publishOperation.count({ where: { proposalId: proposal.id } })).toBe(1);
      expect(moodle.createdCount).toBe(4);
    });

    it("si Moodle cae a mitad, se reanuda sin duplicar", async () => {
      const proposal = await approved();
      moodle.failAtCall = 3;
      await publish(proposal.id, `clave-real-${randomUUID()}`).expect(202);
      expect(
        (await prisma.courseProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status,
      ).toBe("FAILED");

      await publish(proposal.id, `clave-real-${randomUUID()}`).expect(202);

      const stored = await prisma.courseProposal.findUniqueOrThrow({ where: { id: proposal.id } });
      expect(stored.status).toBe("PUBLISHED");
      expect(moodle.createdCount).toBe(4);
      expect(await prisma.publishOperation.count({ where: { proposalId: proposal.id } })).toBe(2);
    });
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
