import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AuditService, type AuditEntry } from "../src/audit/audit.service";
import { AccessService } from "../src/auth/access.service";
import { InMemoryJtiStore, JtiStore } from "../src/auth/jti-store";
import { PrismaService } from "../src/database/prisma.service";
import { MoodleService } from "../src/integrations/moodle/moodle.service";
import type { CourseAccess } from "../src/integrations/moodle/moodle.types";
import { ProposalPublisher } from "../src/proposals/proposal-publisher";
import { PublishDispatcher } from "../src/proposals/publish-dispatcher";
import { FakeMoodle } from "./support/fake-moodle";
import { signPluginToken, TEST_ISSUER, TEST_SECRET } from "./support/plugin-token";
import { DOC_ID, ProposalsStore } from "./support/proposals-store";

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

let keyCounter = 0;
/** Una clave de idempotencia válida (16 a 128 caracteres) distinta cada vez. */
const newKey = () => `clave-de-prueba-${String(++keyCounter).padStart(6, "0")}`;

describe("Publicación de propuestas (e2e)", () => {
  let app: INestApplication;
  const store = new ProposalsStore();
  const moodle = new FakeMoodle();
  const audit: AuditEntry[] = [];
  let dispatchFails = false;

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
      .overrideProvider(AuditService)
      .useValue({ record: async (entry: AuditEntry) => void audit.push(entry) })
      .overrideProvider(PrismaService)
      .useValue(store.prisma())
      .overrideProvider(MoodleService)
      .useValue(moodle)
      // La publicación real corre en la cola; aquí se ejecuta en el acto para probar el resultado.
      .overrideProvider(PublishDispatcher)
      .useFactory({
        inject: [ProposalPublisher],
        factory: (publisher: ProposalPublisher) => ({
          dispatch: async (operationId: string) => {
            if (dispatchFails) throw new Error("Redis caído");
            await publisher.run(operationId);
          },
        }),
      })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    store.reset();
    moodle.reset();
    audit.length = 0;
    dispatchFails = false;
    Object.assign(capabilities, { use: true, publish: true, viewanalytics: true, admin: false });
  });

  afterAll(async () => {
    await app.close();
  });

  const call = (
    method: "get" | "post" | "patch",
    path: string,
    body?: object,
    options: { courseId?: number; key?: string | null } = {},
  ) => {
    const req = request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set("Authorization", `Bearer ${signPluginToken({ courseid: options.courseId ?? 7 })}`);
    if (options.key) req.set("Idempotency-Key", options.key);
    return body ? req.send(body) : req;
  };

  /** Una propuesta aprobada, lista para publicar. */
  const approvedProposal = async () => {
    const created = await call("post", "/proposals", {
      syllabusId: DOC_ID,
      extractionVersion: 1,
      confirmDuplicate: true,
    }).expect(201);
    await call("post", `/proposals/${created.body.id}/approve`).expect(200);
    return created.body as { id: string; items: { id: string; title: string }[] };
  };

  const publish = (
    proposalId: string,
    key: string | null = newKey(),
    body: object = { confirm: true },
  ) => call("post", `/proposals/${proposalId}/publish`, body, { key });

  const operation = (proposalId: string, operationId: string, courseId = 7) =>
    call("get", `/proposals/${proposalId}/publish-operations/${operationId}`, undefined, {
      courseId,
    });

  const statusOf = () => store.proposals[0]!.status;

  describe("publicación normal", () => {
    it("FUN-06: crea secciones y actividades en Moodle y guarda sus ids", async () => {
      const proposal = await approvedProposal();

      const started = await publish(proposal.id).expect(202);
      const result = await operation(proposal.id, started.body.id).expect(200);

      expect(result.body).toMatchObject({
        status: "SUCCEEDED",
        totalCount: 4,
        createdCount: 4,
        failedCount: 0,
        failures: [],
      });
      expect(result.body.finishedAt).not.toBeNull();
      expect(statusOf()).toBe("PUBLISHED");
      expect(store.proposals[0]!.publishedAt).toBeInstanceOf(Date);
      expect(moodle.sections.size).toBe(2);
      expect(moodle.modules.size).toBe(2);
      expect(store.items.map((i) => [i.publishStatus, i.moodleItemId !== null])).toEqual([
        ["CREATED", true],
        ["CREATED", true],
        ["CREATED", true],
        ["CREATED", true],
      ]);
    });

    it("las actividades se crean dentro de su sección, con su tipo y fecha", async () => {
      const proposal = await approvedProposal();

      await publish(proposal.id).expect(202);

      const [first, second] = [...moodle.modules.values()];
      const [sectionA, sectionB] = [...moodle.sections.values()];
      expect(first).toMatchObject({
        modname: "assign",
        name: "Especificación de requisitos",
        dueDate: "2026-12-04",
        sectionid: sectionA!.sectionid,
      });
      expect(second).toMatchObject({
        modname: "assign",
        name: "Documento de arquitectura",
        dueDate: null,
        sectionid: sectionB!.sectionid,
      });
    });

    it("publica solo lo aprobado: una actividad quitada antes de aprobar no se crea", async () => {
      const created = await call("post", "/proposals", {
        syllabusId: DOC_ID,
        extractionVersion: 1,
      }).expect(201);
      const items = created.body.items.slice(0, 3);
      await call("patch", `/proposals/${created.body.id}`, { items }).expect(200);
      await call("post", `/proposals/${created.body.id}/approve`).expect(200);

      await publish(created.body.id).expect(202);

      expect(moodle.sections.size).toBe(2);
      expect(moodle.modules.size).toBe(1);
      expect(moodle.modules.has(created.body.items[3].id)).toBe(false);
    });

    it("audita el inicio y el fin sin títulos ni contenido", async () => {
      const proposal = await approvedProposal();

      await publish(proposal.id).expect(202);

      expect(audit.map((entry) => entry.action)).toEqual(
        expect.arrayContaining(["proposal.publish", "proposal.publish.finished"]),
      );
      expect(JSON.stringify(audit)).not.toContain("Especificación");
    });
  });

  describe("relación con las unidades del sílabo", () => {
    it("cada actividad creada queda relacionada con su unidad; las secciones no", async () => {
      const proposal = await approvedProposal();

      await publish(proposal.id).expect(202);

      const [first, second] = [...moodle.modules.values()];
      expect(store.mappings).toEqual([
        expect.objectContaining({
          moodleCourseId: 7,
          moodleCmId: first!.cmid,
          unitRef: "gradingPeriods[0].units[0]",
          learningOutcomeIds: ["RA1"],
          source: "PROPOSAL",
        }),
        expect.objectContaining({
          moodleCmId: second!.cmid,
          unitRef: "gradingPeriods[1].units[0]",
          source: "PROPOSAL",
        }),
      ]);
    });

    it("no sobrescribe lo que el docente relacionó a mano", async () => {
      const proposal = await approvedProposal();
      store.mappings.push({
        integrationAccountId: "cuenta-1",
        moodleCourseId: 7,
        moodleCmId: 101,
        unitRef: "gradingPeriods[1].units[0]",
        learningOutcomeIds: [],
        source: "MANUAL",
      });

      await publish(proposal.id).expect(202);

      expect(store.mappings.find((m) => m.moodleCmId === 101)).toMatchObject({
        unitRef: "gradingPeriods[1].units[0]",
        source: "MANUAL",
      });
    });

    it("una unidad creada por el docente (sin ruta en el sílabo) no se relaciona", async () => {
      const proposal = await approvedProposal();
      const items = proposal.items.slice(0, 2).map((item) => ({ ...item }));
      items.push({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        itemType: "SECTION",
        title: "Extra",
      } as never);
      items.push({
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        parentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        itemType: "FORUM",
        title: "Foro",
        learningOutcomeIds: ["RA1"],
      } as never);
      await call("patch", `/proposals/${proposal.id}`, { items }).expect(200);
      await call("post", `/proposals/${proposal.id}/approve`).expect(200);

      await publish(proposal.id).expect(202);

      expect(store.mappings.map((m) => m.unitRef)).toEqual(["gradingPeriods[0].units[0]"]);
    });

    it("si no se puede escribir la relación, la publicación termina igual", async () => {
      const proposal = await approvedProposal();
      store.breakMappings = true;

      const started = await publish(proposal.id).expect(202);

      expect((await operation(proposal.id, started.body.id)).body.status).toBe("SUCCEEDED");
      expect(statusOf()).toBe("PUBLISHED");
      expect(store.mappings).toEqual([]);
    });

    it("al reanudar tras un fallo no duplica las relaciones", async () => {
      const proposal = await approvedProposal();
      moodle.failAtCall = 4;
      await publish(proposal.id).expect(202);
      expect(store.mappings).toHaveLength(1);

      await publish(proposal.id).expect(202);

      expect(store.mappings).toHaveLength(2);
    });
  });

  describe("seguimiento desde la propuesta", () => {
    it("una propuesta nunca publicada no tiene operación", async () => {
      const proposal = await approvedProposal();

      const res = await call("get", `/proposals/${proposal.id}`).expect(200);

      expect(res.body.lastPublishOperation).toBeNull();
    });

    it("la propuesta indica su última operación, para retomar el seguimiento", async () => {
      const proposal = await approvedProposal();
      moodle.failAtCall = 3;
      const first = await publish(proposal.id).expect(202);
      expect((await call("get", `/proposals/${proposal.id}`)).body.lastPublishOperation).toEqual({
        id: first.body.id,
        status: "FAILED",
      });

      const resumed = await publish(proposal.id).expect(202);

      expect((await call("get", `/proposals/${proposal.id}`)).body.lastPublishOperation).toEqual({
        id: resumed.body.id,
        status: "SUCCEEDED",
      });
    });
  });

  describe("repetición e idempotencia (SEC-04)", () => {
    it("la misma clave devuelve la misma operación y no crea nada más", async () => {
      const proposal = await approvedProposal();
      const key = newKey();

      const first = await publish(proposal.id, key).expect(202);
      const callsAfterFirst = moodle.calls.length;
      const second = await publish(proposal.id, key).expect(202);

      expect(second.body.id).toBe(first.body.id);
      expect(moodle.calls).toHaveLength(callsAfterFirst);
      expect(moodle.createdCount).toBe(4);
      expect(store.operations).toHaveLength(1);
    });

    it("tres peticiones simultáneas con la misma clave crean una sola operación", async () => {
      const proposal = await approvedProposal();
      const key = newKey();

      const results = await Promise.all([
        publish(proposal.id, key),
        publish(proposal.id, key),
        publish(proposal.id, key),
      ]);

      expect(results.map((res) => res.status)).toEqual([202, 202, 202]);
      expect(new Set(results.map((res) => res.body.id)).size).toBe(1);
      expect(store.operations).toHaveLength(1);
      expect(moodle.createdCount).toBe(4);
    });

    it("otra clave sobre una propuesta ya publicada responde 409 y no crea nada", async () => {
      const proposal = await approvedProposal();
      await publish(proposal.id).expect(202);
      const created = moodle.createdCount;

      const res = await publish(proposal.id).expect(409);

      expect(res.body.code).toBe("INVALID_TRANSITION");
      expect(moodle.createdCount).toBe(created);
    });

    it("una clave ya usada en otra propuesta responde 409", async () => {
      const first = await approvedProposal();
      const key = newKey();
      await publish(first.id, key).expect(202);
      const second = await approvedProposal();

      const res = await publish(second.id, key).expect(409);

      expect(res.body.code).toBe("IDEMPOTENCY_KEY_REUSED");
    });
  });

  describe("validación de la petición", () => {
    it("sin Idempotency-Key responde 400", async () => {
      const proposal = await approvedProposal();

      const res = await publish(proposal.id, null).expect(400);

      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(moodle.calls).toHaveLength(0);
    });

    it("una clave demasiado corta responde 400", async () => {
      const proposal = await approvedProposal();

      await publish(proposal.id, "corta").expect(400);
    });

    it.each([{}, { confirm: false }, { confirm: "true" }])(
      "sin confirmación explícita (%j) responde 400",
      async (body) => {
        const proposal = await approvedProposal();

        await publish(proposal.id, newKey(), body).expect(400);

        expect(statusOf()).toBe("APPROVED");
        expect(moodle.calls).toHaveLength(0);
      },
    );

    it("una propuesta sin aprobar no se publica", async () => {
      const created = await call("post", "/proposals", {
        syllabusId: DOC_ID,
        extractionVersion: 1,
      }).expect(201);

      const res = await publish(created.body.id).expect(409);

      expect(res.body.code).toBe("INVALID_TRANSITION");
      expect(moodle.calls).toHaveLength(0);
    });

    it("una propuesta editada después de aprobarla vuelve a revisión y no se publica", async () => {
      const proposal = await approvedProposal();
      await call("patch", `/proposals/${proposal.id}`, { items: [] }).expect(200);

      await publish(proposal.id).expect(409);

      expect(moodle.calls).toHaveLength(0);
    });
  });

  describe("fallos a mitad de la publicación", () => {
    it("si Moodle cae, la propuesta queda FAILED con el detalle por elemento", async () => {
      const proposal = await approvedProposal();
      moodle.failAtCall = 3;

      const started = await publish(proposal.id).expect(202);
      const result = await operation(proposal.id, started.body.id).expect(200);

      expect(result.body).toMatchObject({ status: "FAILED", createdCount: 2, failedCount: 1 });
      expect(result.body.failures).toEqual([
        { itemId: proposal.items[2]!.id, error: "MOODLE_UNAVAILABLE" },
      ]);
      expect(statusOf()).toBe("FAILED");
      const byPosition = [...store.items].sort((a, b) => a.position - b.position);
      expect(byPosition.map((i) => i.publishStatus)).toEqual([
        "CREATED",
        "CREATED",
        "FAILED",
        "PENDING",
      ]);
    });

    it("se reanuda desde el último elemento creado y no duplica nada", async () => {
      const proposal = await approvedProposal();
      moodle.failAtCall = 3;
      await publish(proposal.id).expect(202);
      const callsBefore = moodle.calls.length;

      const resumed = await publish(proposal.id).expect(202);
      const result = await operation(proposal.id, resumed.body.id).expect(200);

      expect(result.body).toMatchObject({
        status: "SUCCEEDED",
        createdCount: 2,
        failedCount: 0,
        failures: [],
      });
      expect(statusOf()).toBe("PUBLISHED");
      expect(moodle.createdCount).toBe(4);
      // Solo se llamó a Moodle por los dos elementos pendientes.
      expect(moodle.calls.length - callsBefore).toBe(2);
      expect(store.items.every((i) => i.publishStatus === "CREATED")).toBe(true);
    });

    it("si Moodle aplicó la llamada pero se perdió la respuesta, al reanudar no se duplica", async () => {
      const proposal = await approvedProposal();
      moodle.loseResponseAtCall = 2;
      await publish(proposal.id).expect(202);
      expect(statusOf()).toBe("FAILED");
      // Moodle ya tiene el elemento aunque el backend no lo sabía.
      expect(moodle.modules.size).toBe(1);

      const resumed = await publish(proposal.id).expect(202);
      const result = await operation(proposal.id, resumed.body.id).expect(200);

      expect(result.body.status).toBe("SUCCEEDED");
      expect(moodle.sections.size).toBe(2);
      expect(moodle.modules.size).toBe(2);
      expect(moodle.createdCount).toBe(4);
    });

    it("una propuesta en publicación no admite otra publicación ni ediciones", async () => {
      const proposal = await approvedProposal();
      store.proposals[0]!.status = "PUBLISHING";

      await publish(proposal.id).expect(409);
      const res = await call("patch", `/proposals/${proposal.id}`, { items: [] }).expect(409);

      expect(res.body.code).toBe("PROPOSAL_NOT_EDITABLE");
    });

    it("si no se puede encolar, responde 503 y la propuesta se puede reanudar", async () => {
      const proposal = await approvedProposal();
      dispatchFails = true;

      const res = await publish(proposal.id).expect(503);

      expect(res.body.code).toBe("PUBLISH_QUEUE_UNAVAILABLE");
      expect(statusOf()).toBe("FAILED");
      expect(store.operations[0]!.status).toBe("FAILED");

      dispatchFails = false;
      const resumed = await publish(proposal.id).expect(202);
      expect((await operation(proposal.id, resumed.body.id)).body.status).toBe("SUCCEEDED");
    });
  });

  describe("permisos", () => {
    it("sin la capacidad publish responde 403 y no toca Moodle", async () => {
      const proposal = await approvedProposal();
      capabilities.publish = false;

      const res = await publish(proposal.id).expect(403);

      expect(res.body.code).toBe("FORBIDDEN_CAPABILITY");
      expect(moodle.calls).toHaveLength(0);
      expect(statusOf()).toBe("APPROVED");
    });

    it("si Moodle niega el permiso al docente, la publicación falla sin crear nada", async () => {
      const proposal = await approvedProposal();
      moodle.denyPermissions = true;

      const started = await publish(proposal.id).expect(202);
      const result = await operation(proposal.id, started.body.id).expect(200);

      expect(result.body).toMatchObject({ status: "FAILED", createdCount: 0, failedCount: 1 });
      expect(result.body.failures[0]).toEqual({
        itemId: proposal.items[0]!.id,
        error: "MOODLE_PERMISSION",
      });
      expect(moodle.createdCount).toBe(0);
      expect(statusOf()).toBe("FAILED");
    });

    it("SEC-01: no se publica una propuesta de otro curso", async () => {
      const proposal = await approvedProposal();

      await call(
        "post",
        `/proposals/${proposal.id}/publish`,
        { confirm: true },
        { courseId: 8, key: newKey() },
      ).expect(404);

      expect(moodle.calls).toHaveLength(0);
      expect(statusOf()).toBe("APPROVED");
    });

    it("la operación solo se consulta en su propuesta y su curso", async () => {
      const proposal = await approvedProposal();
      const other = await approvedProposal();
      const started = await publish(proposal.id).expect(202);

      await operation(other.id, started.body.id).expect(404);
      await operation(proposal.id, started.body.id, 8).expect(404);
      await operation(proposal.id, "no-es-un-uuid").expect(404);
    });
  });
});
