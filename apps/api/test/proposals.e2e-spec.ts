import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AuditService, type AuditEntry } from "../src/audit/audit.service";
import { AccessService } from "../src/auth/access.service";
import { InMemoryJtiStore, JtiStore } from "../src/auth/jti-store";
import { PrismaService } from "../src/database/prisma.service";
import type { CourseAccess } from "../src/integrations/moodle/moodle.types";
import { signPluginToken, TEST_ISSUER, TEST_SECRET } from "./support/plugin-token";
import {
  DOC_ID,
  OTHER_COURSE_DOC_ID,
  ProposalsStore,
  UNREVIEWED_DOC_ID,
} from "./support/proposals-store";

const NEW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MISSING_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

/** Moodle simulado: el usuario 42 es docente del curso 7; `capabilities` se cambia por prueba. */
const capabilities = { use: true, publish: true, viewanalytics: true, admin: false };
const fakeAccess = {
  getAccess: async (userId: number, courseId: number): Promise<CourseAccess> => ({
    userid: userId,
    courseid: courseId,
    courseexists: true,
    active: true,
    roles: ["editingteacher"],
    capabilities: { ...capabilities },
  }),
};

describe("Propuestas (e2e)", () => {
  let app: INestApplication;
  const store = new ProposalsStore();
  const audit: AuditEntry[] = [];

  beforeAll(async () => {
    process.env.LOG_LEVEL = "fatal";
    process.env.PLUGIN_JWT_SECRET = TEST_SECRET;
    process.env.MOODLE_BASE_URL = TEST_ISSUER;
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
      .useValue(store.prisma())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    store.reset();
    audit.length = 0;
    Object.assign(capabilities, { use: true, publish: true, viewanalytics: true, admin: false });
  });

  afterAll(async () => {
    await app.close();
  });

  const call = (method: "get" | "post" | "patch", path: string, body?: object, courseId = 7) => {
    const req = request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set("Authorization", `Bearer ${signPluginToken({ courseid: courseId })}`);
    return body ? req.send(body) : req;
  };

  const create = (overrides: object = {}) =>
    call("post", "/proposals", { syllabusId: DOC_ID, extractionVersion: 1, ...overrides });

  /** Crea una propuesta válida y devuelve su cuerpo. */
  const createdProposal = async () => (await create().expect(201)).body;

  /** Elementos de la propuesta como los enviaría el plugin al editar. */
  const editable = (proposal: { items: Record<string, unknown>[] }) =>
    proposal.items.map((item) => {
      const editableItem = { ...item };
      delete editableItem.moodleItemId;
      delete editableItem.publishStatus;
      return editableItem;
    });

  describe("GET /proposals/latest", () => {
    it("devuelve la propuesta más reciente del curso, para retomarla al abrir la página", async () => {
      const first = await createdProposal();
      const second = (await create({ confirmDuplicate: true }).expect(201)).body;
      store.proposals.find((p) => p.id === second.id)!.updatedAt = new Date("2026-11-10T00:00:00Z");

      const res = await call("get", "/proposals/latest").expect(200);

      expect(res.body.id).toBe(second.id);
      expect(res.body.id).not.toBe(first.id);
      expect(res.body.items.length).toBeGreaterThan(0);
    });

    it("no cuenta las rechazadas", async () => {
      const first = await createdProposal();
      const second = (await create({ confirmDuplicate: true }).expect(201)).body;
      const rejected = store.proposals.find((p) => p.id === second.id)!;
      rejected.updatedAt = new Date("2026-11-10T00:00:00Z");
      rejected.status = "REJECTED";

      const res = await call("get", "/proposals/latest").expect(200);

      expect(res.body.id).toBe(first.id);
    });

    it("responde 404 si el curso no tiene propuestas, y no usa las de otro curso (SEC-01)", async () => {
      await createdProposal();

      const res = await call("get", "/proposals/latest", undefined, 8).expect(404);

      expect(res.body.code).toBe("PROPOSAL_NOT_FOUND");
    });
  });

  describe("POST /proposals", () => {
    it("RF-07: genera la propuesta de una extracción revisada, lista para revisión", async () => {
      const res = await create();

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        courseId: 7,
        syllabusId: DOC_ID,
        extractionVersion: 1,
        status: "NEEDS_REVIEW",
        approvedBy: null,
        approvedAt: null,
      });
      expect(
        res.body.items.map((i: { itemType: string; title: string }) => [i.itemType, i.title]),
      ).toEqual([
        ["SECTION", "Requisitos"],
        ["ASSIGN", "Especificación de requisitos"],
        ["SECTION", "Arquitectura"],
        ["ASSIGN", "Documento de arquitectura"],
      ]);
      expect(res.body.items[1]).toMatchObject({
        parentId: res.body.items[0].id,
        dueDate: "2026-12-04",
        weight: 30,
        learningOutcomeIds: ["RA1"],
        publishStatus: "PENDING",
        moodleItemId: null,
      });
      expect(res.body.items[3]).toMatchObject({ dueDate: null, weight: null });
      expect(store.proposals).toHaveLength(1);
      expect(store.proposals[0]).toMatchObject({ createdBy: 42, moodleCourseId: 7 });
      expect(audit).toContainEqual(
        expect.objectContaining({
          action: "proposal.create",
          outcome: "SUCCESS",
          actorMoodleId: 42,
          courseId: 7,
          metadata: { extractionVersion: 1, itemCount: 4 },
        }),
      );
    });

    it("incluye las advertencias de la revisión", async () => {
      const res = await create();

      expect(res.body.issues).toContainEqual(
        expect.objectContaining({ code: "PERIOD_WEIGHTS_NOT_TOTAL", severity: "warning" }),
      );
      expect(res.body.issues.filter((i: { severity: string }) => i.severity === "error")).toEqual(
        [],
      );
    });

    it("RF-07: avisa si el mismo sílabo ya tiene una propuesta y no la duplica sin confirmar", async () => {
      const first = await createdProposal();

      const res = await create().expect(409);

      expect(res.body).toMatchObject({
        code: "PROPOSAL_EXISTS",
        details: [{ path: "proposalId", message: first.id }],
      });
      expect(store.proposals).toHaveLength(1);

      await create({ confirmDuplicate: true }).expect(201);
      expect(store.proposals).toHaveLength(2);
    });

    it("no cuenta como duplicada una propuesta rechazada", async () => {
      const first = await createdProposal();
      store.proposals.find((p) => p.id === first.id)!.status = "REJECTED";

      await create().expect(201);
    });

    it("exige que el docente haya revisado la extracción", async () => {
      const res = await create({ syllabusId: UNREVIEWED_DOC_ID }).expect(409);

      expect(res.body.code).toBe("EXTRACTION_NOT_REVIEWED");
      expect(store.proposals).toHaveLength(0);
    });

    it("SEC-01: un sílabo de otro curso responde 404, igual que uno inexistente", async () => {
      const other = await create({ syllabusId: OTHER_COURSE_DOC_ID }).expect(404);
      const missing = await create({ syllabusId: MISSING_ID }).expect(404);

      expect(other.body).toEqual(missing.body);
      expect(other.body.code).toBe("SYLLABUS_NOT_FOUND");
    });

    it("responde 404 si la versión de la extracción no existe", async () => {
      const res = await create({ extractionVersion: 9 }).expect(404);

      expect(res.body.code).toBe("EXTRACTION_NOT_FOUND");
    });

    it("responde 400 con el detalle de lo inválido", async () => {
      const res = await call("post", "/proposals", {
        syllabusId: "no-es-uuid",
        extractionVersion: 0,
      }).expect(400);

      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.details.map((d: { path: string }) => d.path).sort()).toEqual([
        "extractionVersion",
        "syllabusId",
      ]);
    });

    it("sin la capacidad publish responde 403 y no crea nada", async () => {
      capabilities.publish = false;

      const res = await create().expect(403);

      expect(res.body.code).toBe("FORBIDDEN_CAPABILITY");
      expect(store.proposals).toHaveLength(0);
    });

    it("sin token responde 401", async () => {
      await request(app.getHttpServer()).post("/api/v1/proposals").send({}).expect(401);
    });
  });

  describe("GET /proposals/:id", () => {
    it("devuelve la propuesta del curso", async () => {
      const proposal = await createdProposal();

      const res = await call("get", `/proposals/${proposal.id}`).expect(200);

      expect(res.body).toEqual(proposal);
    });

    it("la puede ver quien tiene `use` aunque no pueda publicar", async () => {
      const proposal = await createdProposal();
      capabilities.publish = false;

      await call("get", `/proposals/${proposal.id}`).expect(200);
    });

    it("SEC-01: una propuesta de otro curso responde 404", async () => {
      const proposal = await createdProposal();

      const res = await call("get", `/proposals/${proposal.id}`, undefined, 8).expect(404);

      expect(res.body.code).toBe("PROPOSAL_NOT_FOUND");
    });

    it("un id inexistente o mal formado responde 404", async () => {
      await call("get", `/proposals/${MISSING_ID}`).expect(404);
      await call("get", "/proposals/no-es-un-uuid").expect(404);
    });
  });

  describe("PATCH /proposals/:id", () => {
    it("edita, agrega y quita elementos, y el orden sigue al arreglo", async () => {
      const proposal = await createdProposal();
      const items = editable(proposal);
      items[0] = { ...items[0], title: "Requisitos de software" };
      items.splice(3, 1);
      items.splice(2, 0, {
        id: NEW_ID,
        parentId: proposal.items[0].id,
        itemType: "FORUM",
        title: "Foro de dudas",
      });

      const res = await call("patch", `/proposals/${proposal.id}`, { items }).expect(200);

      expect(res.body.status).toBe("NEEDS_REVIEW");
      expect(
        res.body.items.map((i: { title: string; position: number }) => [i.position, i.title]),
      ).toEqual([
        [0, "Requisitos de software"],
        [1, "Especificación de requisitos"],
        [2, "Foro de dudas"],
        [3, "Arquitectura"],
      ]);
      expect(res.body.items[2]).toMatchObject({
        id: NEW_ID,
        parentId: proposal.items[0].id,
        unitRef: "gradingPeriods[0].units[0]",
        dueDate: null,
        weight: null,
      });
      expect(store.items.filter((i) => i.proposalId === proposal.id)).toHaveLength(4);
      expect(audit).toContainEqual(
        expect.objectContaining({
          action: "proposal.update",
          metadata: { itemCount: 4, status: "NEEDS_REVIEW" },
        }),
      );
    });

    it("ignora los campos de solo lectura que el cliente devuelva", async () => {
      const proposal = await createdProposal();
      const items = proposal.items.map((item: object) => ({
        ...item,
        moodleItemId: 999,
        publishStatus: "CREATED",
      }));

      const res = await call("patch", `/proposals/${proposal.id}`, { items }).expect(200);

      for (const item of res.body.items) {
        expect(item).toMatchObject({ moodleItemId: null, publishStatus: "PENDING" });
      }
    });

    it("rechaza una estructura inválida con 400 y no cambia nada", async () => {
      const proposal = await createdProposal();
      const items = editable(proposal);
      items[1] = { ...items[1], parentId: null };

      const res = await call("patch", `/proposals/${proposal.id}`, { items }).expect(400);

      expect(res.body.details).toEqual([
        { path: "items.1.parentId", message: "Una actividad debe estar dentro de una sección." },
      ]);
      expect(store.items.filter((i) => i.proposalId === proposal.id)).toHaveLength(4);
    });

    it("rechaza valores fuera de rango con 400", async () => {
      const proposal = await createdProposal();
      const items = editable(proposal);
      items[1] = { ...items[1], weight: 150, dueDate: "2026-13-45" };

      const res = await call("patch", `/proposals/${proposal.id}`, { items }).expect(400);

      expect(res.body.details.map((d: { path: string }) => d.path).sort()).toEqual([
        "items.1.dueDate",
        "items.1.weight",
      ]);
    });

    it("rechaza un id de elemento que ya usa otra propuesta", async () => {
      const first = await createdProposal();
      await create({ confirmDuplicate: true }).expect(201);
      const second = store.proposals[1]!;
      const stolen = store.items.find((i) => i.proposalId === first.id)!;
      const items = editable(await (await call("get", `/proposals/${second.id}`)).body);
      items.push({ id: stolen.id, parentId: items[0]!.id, itemType: "FORUM", title: "Robado" });

      const res = await call("patch", `/proposals/${second.id}`, { items }).expect(409);

      expect(res.body.code).toBe("ITEM_ID_CONFLICT");
    });

    it("una propuesta aprobada vuelve a revisión y pierde la aprobación", async () => {
      const proposal = await createdProposal();
      await call("post", `/proposals/${proposal.id}/approve`).expect(200);

      const res = await call("patch", `/proposals/${proposal.id}`, {
        items: editable(proposal),
      }).expect(200);

      expect(res.body).toMatchObject({
        status: "NEEDS_REVIEW",
        approvedBy: null,
        approvedAt: null,
      });
    });

    it.each(["PUBLISHING", "PUBLISHED", "REJECTED", "FAILED"])(
      "una propuesta %s ya no se puede editar",
      async (status) => {
        const proposal = await createdProposal();
        store.proposals[0]!.status = status;

        const res = await call("patch", `/proposals/${proposal.id}`, {
          items: editable(proposal),
        }).expect(409);

        expect(res.body.code).toBe("PROPOSAL_NOT_EDITABLE");
        expect(store.items.filter((i) => i.proposalId === proposal.id)).toHaveLength(4);
      },
    );

    it("sin la capacidad publish responde 403", async () => {
      const proposal = await createdProposal();
      capabilities.publish = false;

      await call("patch", `/proposals/${proposal.id}`, { items: [] }).expect(403);
    });

    it("SEC-01: no edita una propuesta de otro curso", async () => {
      const proposal = await createdProposal();

      await call("patch", `/proposals/${proposal.id}`, { items: [] }, 8).expect(404);
      expect(store.items.filter((i) => i.proposalId === proposal.id)).toHaveLength(4);
    });
  });

  describe("POST /proposals/:id/approve", () => {
    it("FUN-05: aprueba y registra quién y cuándo", async () => {
      const proposal = await createdProposal();

      const res = await call("post", `/proposals/${proposal.id}/approve`).expect(200);

      expect(res.body).toMatchObject({ status: "APPROVED", approvedBy: 42 });
      expect(new Date(res.body.approvedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
      expect(audit).toContainEqual(
        expect.objectContaining({
          action: "proposal.approve",
          outcome: "SUCCESS",
          actorMoodleId: 42,
        }),
      );
    });

    it("RF-08: aprobar dos veces responde 409 por transición inválida", async () => {
      const proposal = await createdProposal();
      await call("post", `/proposals/${proposal.id}/approve`).expect(200);

      const res = await call("post", `/proposals/${proposal.id}/approve`).expect(409);

      expect(res.body).toMatchObject({ code: "INVALID_TRANSITION" });
      expect(res.body.message).toContain("APPROVED");
    });

    it.each(["DRAFT", "PUBLISHING", "PUBLISHED", "REJECTED", "FAILED"])(
      "RF-08: una propuesta %s no se puede aprobar",
      async (status) => {
        const proposal = await createdProposal();
        store.proposals[0]!.status = status;

        const res = await call("post", `/proposals/${proposal.id}/approve`).expect(409);

        expect(res.body.code).toBe("INVALID_TRANSITION");
        expect(store.proposals[0]!.status).toBe(status);
      },
    );

    it("no aprueba una propuesta con errores y los detalla", async () => {
      const proposal = await createdProposal();
      const items = editable(proposal);
      items[1] = { ...items[1], weight: 70 };
      items.splice(2, 0, {
        parentId: proposal.items[0].id,
        itemType: "QUIZ",
        title: "Quiz",
        weight: 50,
      });
      await call("patch", `/proposals/${proposal.id}`, { items }).expect(200);

      const res = await call("post", `/proposals/${proposal.id}/approve`).expect(409);

      expect(res.body.code).toBe("PROPOSAL_HAS_ERRORS");
      expect(res.body.details).toEqual([
        { path: "proposal", message: "Las ponderaciones de el periodo 1 suman 120, más de 100." },
      ]);
      expect(store.proposals[0]!.status).toBe("NEEDS_REVIEW");
    });

    it("no aprueba un título vacío", async () => {
      const proposal = await createdProposal();
      const items = editable(proposal);
      items[0] = { ...items[0], title: "" };
      await call("patch", `/proposals/${proposal.id}`, { items }).expect(200);

      const res = await call("post", `/proposals/${proposal.id}/approve`).expect(409);

      expect(res.body.code).toBe("PROPOSAL_HAS_ERRORS");
    });

    it("si otra petición cambió el estado antes, responde 409 sin aprobar dos veces", async () => {
      const proposal = await createdProposal();
      store.loseNextRace = true;

      const res = await call("post", `/proposals/${proposal.id}/approve`).expect(409);

      expect(res.body.code).toBe("PROPOSAL_CHANGED");
      expect(store.proposals[0]!.status).toBe("NEEDS_REVIEW");
    });

    it("sin la capacidad publish responde 403 y no aprueba", async () => {
      const proposal = await createdProposal();
      capabilities.publish = false;

      await call("post", `/proposals/${proposal.id}/approve`).expect(403);
      expect(store.proposals[0]!.status).toBe("NEEDS_REVIEW");
    });

    it("SEC-01: no aprueba una propuesta de otro curso", async () => {
      const proposal = await createdProposal();

      await call("post", `/proposals/${proposal.id}/approve`, undefined, 8).expect(404);
      expect(store.proposals[0]!.status).toBe("NEEDS_REVIEW");
    });
  });
});
