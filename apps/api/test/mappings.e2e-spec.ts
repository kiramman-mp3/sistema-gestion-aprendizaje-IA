import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { buildSyllabusExtraction } from "@smart-lms/contracts";
import request from "supertest";
import { AuditService, type AuditEntry } from "../src/audit/audit.service";
import { AccessService } from "../src/auth/access.service";
import { InMemoryJtiStore, JtiStore } from "../src/auth/jti-store";
import { PrismaService } from "../src/database/prisma.service";
import type { CourseAccess } from "../src/integrations/moodle/moodle.types";
import { signPluginToken, TEST_ISSUER, TEST_SECRET } from "./support/plugin-token";

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

interface Doc {
  id: string;
  moodleCourseId: number;
  status: string;
  createdAt: Date;
  extractions: { version: number; content: unknown }[];
}
interface Row {
  integrationAccountId: string;
  moodleCourseId: number;
  moodleCmId: number;
  unitRef: string;
  learningOutcomeIds: string[];
  source: "PROPOSAL" | "MANUAL";
}

/** Base en memoria con lo justo que usa MappingsService. */
function fakePrisma(docs: Doc[], rows: Row[]) {
  const clone = <T>(value: T): T => structuredClone(value);
  const same = (row: Row, key: { moodleCourseId: number; moodleCmId: number }) =>
    row.moodleCourseId === key.moodleCourseId && row.moodleCmId === key.moodleCmId;
  return {
    integrationAccount: { upsert: async () => ({ id: "cuenta-1" }) },
    syllabusDocument: {
      findFirst: async ({ where }: { where: { moodleCourseId: number; status: string } }) =>
        clone(
          [...docs]
            .filter((d) => d.moodleCourseId === where.moodleCourseId && d.status === where.status)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .map((d) => ({ id: d.id, extractions: d.extractions.slice(0, 1) }))[0] ?? null,
        ),
    },
    activityUnitMapping: {
      findMany: async ({ where }: { where: { moodleCourseId: number } }) =>
        clone(
          rows
            .filter((r) => r.moodleCourseId === where.moodleCourseId)
            .sort((a, b) => a.moodleCmId - b.moodleCmId),
        ),
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { moodleCourseId_moodleCmId: { moodleCourseId: number; moodleCmId: number } };
        create: Row;
        update: Partial<Row>;
      }) => {
        const existing = rows.find((r) => same(r, where.moodleCourseId_moodleCmId));
        if (existing) return clone(Object.assign(existing, update));
        rows.push(clone(create));
        return clone(create);
      },
      deleteMany: async ({ where }: { where: { moodleCourseId: number; moodleCmId: number } }) => {
        const before = rows.length;
        const kept = rows.filter((r) => !same(r, where));
        rows.splice(0, rows.length, ...kept);
        return { count: before - rows.length };
      },
    },
  };
}

const DOC_ID = "d0000000-0000-4000-8000-000000000001";

describe("Relación de actividades con unidades (e2e)", () => {
  let app: INestApplication;
  let docs: Doc[];
  let rows: Row[];
  const audit: AuditEntry[] = [];

  beforeAll(async () => {
    process.env.LOG_LEVEL = "fatal";
    process.env.PLUGIN_JWT_SECRET = TEST_SECRET;
    process.env.MOODLE_BASE_URL = TEST_ISSUER;
    docs = [];
    rows = [];
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
      .useValue(fakePrisma(docs, rows))
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    docs.splice(0, docs.length, {
      id: DOC_ID,
      moodleCourseId: 7,
      status: "REVIEWED",
      createdAt: new Date("2026-11-09T12:00:00Z"),
      extractions: [{ version: 3, content: buildSyllabusExtraction() }],
    });
    rows.splice(0, rows.length);
    audit.length = 0;
    Object.assign(capabilities, { use: true, publish: true, viewanalytics: true, admin: false });
  });

  afterAll(async () => {
    await app.close();
  });

  const call = (method: "get" | "put" | "delete", path: string, body?: object, courseId = 7) => {
    const req = request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set("Authorization", `Bearer ${signPluginToken({ courseid: courseId })}`);
    return body ? req.send(body) : req;
  };

  describe("GET /courses/:courseId/activity-mappings", () => {
    it("devuelve las unidades y los resultados del sílabo revisado", async () => {
      const res = await call("get", "/courses/7/activity-mappings").expect(200);

      expect(res.body).toMatchObject({ syllabusId: DOC_ID, extractionVersion: 3, mappings: [] });
      expect(res.body.units).toEqual([
        {
          unitRef: "gradingPeriods[0].units[0]",
          title: "Requisitos",
          periodName: "Primer parcial",
          learningOutcomeIds: ["RA1"],
        },
        {
          unitRef: "gradingPeriods[1].units[0]",
          title: "Arquitectura",
          periodName: "Segundo parcial",
          learningOutcomeIds: ["RA2"],
        },
      ]);
      expect(res.body.outcomes.map((o: { id: string }) => o.id)).toEqual(["RA1", "RA2"]);
    });

    it("sin sílabo revisado devuelve listas vacías", async () => {
      docs[0]!.status = "EXTRACTED";

      const res = await call("get", "/courses/7/activity-mappings").expect(200);

      expect(res.body).toEqual({
        syllabusId: null,
        extractionVersion: null,
        units: [],
        outcomes: [],
        mappings: [],
      });
    });

    it("usa el sílabo revisado más reciente y su última versión", async () => {
      docs.push({
        id: "d0000000-0000-4000-8000-000000000002",
        moodleCourseId: 7,
        status: "REVIEWED",
        createdAt: new Date("2026-11-10T12:00:00Z"),
        extractions: [{ version: 1, content: buildSyllabusExtraction({ gradingPeriods: [] }) }],
      });

      const res = await call("get", "/courses/7/activity-mappings").expect(200);

      expect(res.body.syllabusId).toBe("d0000000-0000-4000-8000-000000000002");
      expect(res.body.units).toEqual([]);
    });

    it("incluye lo ya relacionado, sin mostrar lo de otros cursos", async () => {
      rows.push(
        {
          integrationAccountId: "a",
          moodleCourseId: 7,
          moodleCmId: 21,
          unitRef: "gradingPeriods[0].units[0]",
          learningOutcomeIds: ["RA1"],
          source: "PROPOSAL",
        },
        {
          integrationAccountId: "a",
          moodleCourseId: 8,
          moodleCmId: 99,
          unitRef: "gradingPeriods[0].units[0]",
          learningOutcomeIds: [],
          source: "MANUAL",
        },
      );

      const res = await call("get", "/courses/7/activity-mappings").expect(200);

      expect(res.body.mappings).toEqual([
        {
          moodleCmId: 21,
          unitRef: "gradingPeriods[0].units[0]",
          learningOutcomeIds: ["RA1"],
          source: "PROPOSAL",
        },
      ]);
    });

    it("SEC-01: un token de otro curso no puede consultar este", async () => {
      const res = await call("get", "/courses/7/activity-mappings", undefined, 8).expect(403);

      expect(res.body.code).toBe("FORBIDDEN_COURSE");
    });

    it("la pueden ver quienes tienen `use` aunque no puedan publicar", async () => {
      capabilities.publish = false;

      await call("get", "/courses/7/activity-mappings").expect(200);
    });
  });

  describe("PUT /courses/:courseId/activity-mappings/:cmId", () => {
    const body = { unitRef: "gradingPeriods[1].units[0]", learningOutcomeIds: ["RA2"] };

    it("relaciona una actividad con una unidad y la marca como manual", async () => {
      const res = await call("put", "/courses/7/activity-mappings/21", body).expect(200);

      expect(res.body).toEqual({
        moodleCmId: 21,
        unitRef: body.unitRef,
        learningOutcomeIds: ["RA2"],
        source: "MANUAL",
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        integrationAccountId: "cuenta-1",
        moodleCourseId: 7,
        moodleCmId: 21,
      });
      expect(audit).toContainEqual(
        expect.objectContaining({
          action: "mapping.save",
          outcome: "SUCCESS",
          actorMoodleId: 42,
          courseId: 7,
          resourceId: "21",
        }),
      );
    });

    it("al relacionar de nuevo reemplaza la relación, también una creada al publicar", async () => {
      rows.push({
        integrationAccountId: "a",
        moodleCourseId: 7,
        moodleCmId: 21,
        unitRef: "gradingPeriods[0].units[0]",
        learningOutcomeIds: ["RA1"],
        source: "PROPOSAL",
      });

      const res = await call("put", "/courses/7/activity-mappings/21", body).expect(200);

      expect(rows).toHaveLength(1);
      expect(res.body).toMatchObject({ unitRef: body.unitRef, source: "MANUAL" });
    });

    it("quita resultados repetidos y acepta una lista vacía", async () => {
      const repeated = await call("put", "/courses/7/activity-mappings/21", {
        unitRef: body.unitRef,
        learningOutcomeIds: ["RA2", "RA2"],
      }).expect(200);
      const none = await call("put", "/courses/7/activity-mappings/22", {
        unitRef: body.unitRef,
      }).expect(200);

      expect(repeated.body.learningOutcomeIds).toEqual(["RA2"]);
      expect(none.body.learningOutcomeIds).toEqual([]);
    });

    it("rechaza una unidad que no existe en el sílabo", async () => {
      const res = await call("put", "/courses/7/activity-mappings/21", {
        unitRef: "gradingPeriods[9].units[9]",
        learningOutcomeIds: [],
      }).expect(400);

      expect(res.body.details).toEqual([
        { path: "unitRef", message: "La unidad no existe en el sílabo revisado." },
      ]);
      expect(rows).toHaveLength(0);
    });

    it("rechaza un resultado de aprendizaje que no existe", async () => {
      const res = await call("put", "/courses/7/activity-mappings/21", {
        unitRef: body.unitRef,
        learningOutcomeIds: ["RA2", "RA9"],
      }).expect(400);

      expect(res.body.details).toEqual([
        {
          path: "learningOutcomeIds.1",
          message: "El resultado de aprendizaje no existe en el sílabo revisado.",
        },
      ]);
    });

    it.each([
      {},
      { unitRef: "" },
      { unitRef: "x", learningOutcomeIds: "RA1" },
      { unitRef: "x", learningOutcomeIds: ["con espacio"] },
    ])("rechaza un cuerpo inválido (%j)", async (invalid) => {
      const res = await call("put", "/courses/7/activity-mappings/21", invalid).expect(400);

      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(rows).toHaveLength(0);
    });

    it.each(["0", "-1", "abc", "1.5", "12345678901"])(
      "rechaza el id de actividad %s",
      async (cmId) => {
        await call("put", `/courses/7/activity-mappings/${cmId}`, body).expect(400);
      },
    );

    it("sin sílabo revisado responde 409", async () => {
      docs[0]!.status = "EXTRACTED";

      const res = await call("put", "/courses/7/activity-mappings/21", body).expect(409);

      expect(res.body.code).toBe("NO_REVIEWED_SYLLABUS");
    });

    it("sin la capacidad publish responde 403 y no guarda nada", async () => {
      capabilities.publish = false;

      const res = await call("put", "/courses/7/activity-mappings/21", body).expect(403);

      expect(res.body.code).toBe("FORBIDDEN_CAPABILITY");
      expect(rows).toHaveLength(0);
    });

    it("SEC-01: un token de otro curso no puede cambiar este", async () => {
      await call("put", "/courses/7/activity-mappings/21", body, 8).expect(403);

      expect(rows).toHaveLength(0);
    });
  });

  describe("DELETE /courses/:courseId/activity-mappings/:cmId", () => {
    it("quita la relación", async () => {
      rows.push({
        integrationAccountId: "a",
        moodleCourseId: 7,
        moodleCmId: 21,
        unitRef: "gradingPeriods[0].units[0]",
        learningOutcomeIds: [],
        source: "MANUAL",
      });

      await call("delete", "/courses/7/activity-mappings/21").expect(204);

      expect(rows).toHaveLength(0);
      expect(audit).toContainEqual(
        expect.objectContaining({ action: "mapping.remove", resourceId: "21" }),
      );
    });

    it("responde 404 si la actividad no estaba relacionada", async () => {
      const res = await call("delete", "/courses/7/activity-mappings/21").expect(404);

      expect(res.body.code).toBe("MAPPING_NOT_FOUND");
    });

    it("no toca la relación de otro curso con el mismo id de actividad", async () => {
      rows.push({
        integrationAccountId: "a",
        moodleCourseId: 8,
        moodleCmId: 21,
        unitRef: "x",
        learningOutcomeIds: [],
        source: "MANUAL",
      });

      await call("delete", "/courses/7/activity-mappings/21").expect(404);

      expect(rows).toHaveLength(1);
    });

    it("sin la capacidad publish responde 403", async () => {
      capabilities.publish = false;

      await call("delete", "/courses/7/activity-mappings/21").expect(403);
    });
  });
});
