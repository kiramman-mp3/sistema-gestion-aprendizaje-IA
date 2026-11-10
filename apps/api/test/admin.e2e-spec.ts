import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
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
    roles: ["manager"],
    capabilities: { ...capabilities },
  }),
};

interface EventRow {
  id: string;
  action: string;
  outcome: "SUCCESS" | "DENIED" | "ERROR";
  actorMoodleId: number | null;
  moodleCourseId: number | null;
  resourceType: string | null;
  resourceId: string | null;
  metadata: unknown;
  createdAt: Date;
}
interface RuleRow {
  id: string;
  integrationAccountId: string;
  moodleCourseId: number | null;
  rule: string;
  enabled: boolean;
  params: unknown;
}

const event = (n: number, extra: Partial<EventRow> = {}): EventRow => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  action: "proposal.publish",
  outcome: "SUCCESS",
  actorMoodleId: 5,
  moodleCourseId: 7,
  resourceType: "proposal",
  resourceId: "p1",
  metadata: { items: 4 },
  createdAt: new Date(Date.UTC(2026, 10, 10, 12, n)),
  ...extra,
});

/** Base en memoria con lo justo que usan los servicios de administración. */
function fakePrisma(events: EventRow[], rules: RuleRow[]) {
  const matches = (row: EventRow, where: Record<string, unknown>): boolean => {
    if (where.moodleCourseId !== undefined && row.moodleCourseId !== where.moodleCourseId)
      return false;
    if (where.actorMoodleId !== undefined && row.actorMoodleId !== where.actorMoodleId)
      return false;
    if (where.outcome !== undefined && row.outcome !== where.outcome) return false;
    const action = where.action as string | { startsWith: string } | undefined;
    if (typeof action === "string" && row.action !== action) return false;
    if (typeof action === "object" && !row.action.startsWith(action.startsWith)) return false;
    const created = where.createdAt as { gte?: Date; lte?: Date } | undefined;
    if (created?.gte && row.createdAt < created.gte) return false;
    if (created?.lte && row.createdAt > created.lte) return false;
    const and =
      (where.AND as {
        OR: [{ createdAt: { lt: Date } }, { createdAt: Date; id: { lt: string } }];
      }[]) ?? [];
    for (const { OR } of and) {
      const [before, tie] = OR;
      const ok =
        row.createdAt < before.createdAt.lt ||
        (row.createdAt.getTime() === tie.createdAt.getTime() && row.id < tie.id.lt);
      if (!ok) return false;
    }
    return true;
  };
  return {
    integrationAccount: { upsert: async () => ({ id: "cuenta-1" }) },
    auditEvent: {
      findMany: async ({ where, take }: { where: Record<string, unknown>; take: number }) =>
        events
          .filter((row) => matches(row, where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
          .slice(0, take),
    },
    difficultyRule: {
      findMany: async ({ where }: { where: { OR: { moodleCourseId: number | null }[] } }) =>
        rules.filter((r) => where.OR.some((o) => o.moodleCourseId === r.moodleCourseId)),
      findFirst: async ({ where }: { where: { moodleCourseId: number | null; rule: string } }) =>
        rules.find((r) => r.moodleCourseId === where.moodleCourseId && r.rule === where.rule) ??
        null,
      create: async ({ data }: { data: Omit<RuleRow, "id"> }) => {
        rules.push({ id: `r${rules.length + 1}`, ...data });
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<RuleRow> }) => {
        Object.assign(
          rules.find((r) => r.id === where.id)!,
          data,
        );
      },
      deleteMany: async ({ where }: { where: { moodleCourseId: number | null; rule: string } }) => {
        const before = rules.length;
        const kept = rules.filter(
          (r) => !(r.moodleCourseId === where.moodleCourseId && r.rule === where.rule),
        );
        rules.splice(0, rules.length, ...kept);
        return { count: before - rules.length };
      },
    },
  };
}

describe("Administración institucional (e2e)", () => {
  let app: INestApplication;
  const events: EventRow[] = [];
  const rules: RuleRow[] = [];
  const audit: AuditEntry[] = [];

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
      .useValue(fakePrisma(events, rules))
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    events.splice(0, events.length, ...[1, 2, 3, 4, 5].map((n) => event(n)));
    rules.splice(0, rules.length);
    audit.length = 0;
    Object.assign(capabilities, { use: true, publish: true, viewanalytics: true, admin: true });
  });

  afterAll(async () => {
    await app.close();
  });

  const call = (method: "get" | "put" | "delete", path: string, body?: object) => {
    const req = request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set("Authorization", `Bearer ${signPluginToken({ courseid: 7 })}`);
    return body ? req.send(body) : req;
  };

  describe("permisos (SEC-02)", () => {
    it.each([
      ["get", "/audit"],
      ["get", "/admin/difficulty-rules"],
      ["put", "/admin/difficulty-rules/MISSING_REQUIRED"],
      ["delete", "/admin/difficulty-rules/MISSING_REQUIRED"],
    ] as const)("un docente sin `admin` no puede %s %s", async (method, path) => {
      capabilities.admin = false;

      const res = await call(method, path, method === "put" ? {} : undefined).expect(403);

      expect(res.body.code).toBe("FORBIDDEN_CAPABILITY");
    });
  });

  describe("GET /audit", () => {
    it("devuelve los eventos más recientes primero, con los campos del contrato", async () => {
      const res = await call("get", "/audit?limit=2").expect(200);

      expect(res.body.items.map((e: { id: string }) => e.id)).toEqual([event(5).id, event(4).id]);
      expect(Object.keys(res.body.items[0]).sort()).toEqual([
        "action",
        "actorMoodleId",
        "courseId",
        "createdAt",
        "id",
        "metadata",
        "outcome",
        "resourceId",
        "resourceType",
      ]);
      expect(res.body.nextCursor).toEqual(expect.any(String));
    });

    it("la página siguiente continúa sin repetir ni saltar eventos", async () => {
      const first = await call("get", "/audit?limit=2").expect(200);
      const second = await call("get", `/audit?limit=2&cursor=${first.body.nextCursor}`).expect(
        200,
      );
      const third = await call("get", `/audit?limit=2&cursor=${second.body.nextCursor}`).expect(
        200,
      );

      const ids = [...first.body.items, ...second.body.items, ...third.body.items].map(
        (e: { id: string }) => e.id,
      );
      expect(ids).toEqual([5, 4, 3, 2, 1].map((n) => event(n).id));
      expect(third.body.nextCursor).toBeNull();
    });

    it("filtra por curso, actor, resultado, acción y fechas", async () => {
      events.push(
        event(6, { moodleCourseId: 9, actorMoodleId: 8, outcome: "DENIED", action: "auth.denied" }),
      );

      const byCourse = await call("get", "/audit?courseId=9").expect(200);
      const byActor = await call("get", "/audit?actorId=8").expect(200);
      const denied = await call("get", "/audit?outcome=DENIED").expect(200);
      const domain = await call("get", "/audit?action=auth.").expect(200);
      const exact = await call("get", "/audit?action=proposal.publish").expect(200);
      const range = await call(
        "get",
        `/audit?from=${encodeURIComponent("2026-11-10T12:02:00Z")}&to=${encodeURIComponent("2026-11-10T12:03:00Z")}`,
      ).expect(200);

      expect(byCourse.body.items).toHaveLength(1);
      expect(byActor.body.items).toHaveLength(1);
      expect(denied.body.items).toHaveLength(1);
      expect(domain.body.items).toHaveLength(1);
      expect(exact.body.items).toHaveLength(5);
      expect(range.body.items.map((e: { id: string }) => e.id)).toEqual([event(3).id, event(2).id]);
    });

    it.each([
      "limit=0",
      "limit=500",
      "courseId=abc",
      "outcome=OTRO",
      "action=Mal%20Formato",
      "from=ayer",
      "cursor=no-es-valido",
      "desconocido=1",
    ])("rechaza el filtro inválido %s con 400 y details", async (query) => {
      const res = await call("get", `/audit?${query}`).expect(400);

      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.details).toEqual(expect.any(Array));
    });

    it("consultar la auditoría deja un evento, sin datos personales", async () => {
      await call("get", "/audit?courseId=7").expect(200);

      expect(audit).toContainEqual(
        expect.objectContaining({
          action: "audit.query",
          outcome: "SUCCESS",
          metadata: expect.objectContaining({ results: 5, filterCourse: 7 }),
        }),
      );
    });
  });

  describe("reglas de dificultad", () => {
    it("sin configuración devuelve las cuatro reglas por defecto", async () => {
      const res = await call("get", "/admin/difficulty-rules").expect(200);

      expect(res.body.courseId).toBeNull();
      expect(res.body.rules.map((r: { rule: string }) => r.rule)).toEqual([
        "MISSING_REQUIRED",
        "GRADE_BELOW_THRESHOLD",
        "SUSTAINED_DECLINE",
        "REPEATED_OUTCOME_DIFFICULTY",
      ]);
      expect(res.body.rules.every((r: { scope: string }) => r.scope === "default")).toBe(true);
    });

    it("guarda una regla institucional y otra del curso, que reemplaza a la anterior", async () => {
      await call("put", "/admin/difficulty-rules/GRADE_BELOW_THRESHOLD", {
        courseId: null,
        enabled: true,
        params: { thresholdPercent: 70 },
      }).expect(200);
      const course = await call("put", "/admin/difficulty-rules/GRADE_BELOW_THRESHOLD", {
        courseId: 7,
        enabled: true,
        params: { thresholdPercent: 50, minActivities: 3 },
      }).expect(200);

      const institution = await call("get", "/admin/difficulty-rules").expect(200);
      const forCourse = await call("get", "/admin/difficulty-rules?courseId=7").expect(200);

      expect(course.body).toMatchObject({ scope: "course", enabled: true });
      const pick = (body: { rules: { rule: string }[] }) =>
        body.rules.find((r) => r.rule === "GRADE_BELOW_THRESHOLD");
      expect(pick(institution.body)).toMatchObject({
        scope: "institution",
        params: { thresholdPercent: 70, minActivities: 2 },
      });
      expect(pick(forCourse.body)).toMatchObject({
        scope: "course",
        params: { thresholdPercent: 50, minActivities: 3 },
      });
    });

    it("actualizar una regla existente no crea otra", async () => {
      const body = { courseId: null, enabled: true, params: {} };
      await call("put", "/admin/difficulty-rules/SUSTAINED_DECLINE", body).expect(200);
      await call("put", "/admin/difficulty-rules/SUSTAINED_DECLINE", {
        ...body,
        enabled: false,
      }).expect(200);

      expect(rules).toHaveLength(1);
      expect(rules[0]).toMatchObject({ enabled: false });
    });

    it.each([
      [{ courseId: null, enabled: true, params: { thresholdPercent: 150 } }],
      [{ courseId: null, enabled: true, params: { desconocido: 1 } }],
      [{ courseId: 0, enabled: true, params: {} }],
      [{ courseId: null, params: {} }],
      [{ courseId: null, enabled: "si", params: {} }],
    ])("rechaza un cuerpo inválido con 400 y details: %j", async (body) => {
      const res = await call("put", "/admin/difficulty-rules/GRADE_BELOW_THRESHOLD", body).expect(
        400,
      );

      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(rules).toHaveLength(0);
    });

    it("una regla que no existe responde 404", async () => {
      const res = await call("put", "/admin/difficulty-rules/INVENTADA", {
        courseId: null,
        enabled: true,
        params: {},
      }).expect(404);

      expect(res.body.code).toBe("RULE_NOT_FOUND");
    });

    it("quitar la regla de un curso devuelve a la institucional; si no hay nada que quitar, 404", async () => {
      await call("put", "/admin/difficulty-rules/MISSING_REQUIRED", {
        courseId: 7,
        enabled: false,
        params: {},
      }).expect(200);

      await call("delete", "/admin/difficulty-rules/MISSING_REQUIRED?courseId=7").expect(204);
      const res = await call(
        "delete",
        "/admin/difficulty-rules/MISSING_REQUIRED?courseId=7",
      ).expect(404);

      expect(res.body.code).toBe("RULE_NOT_FOUND");
      expect(rules).toHaveLength(0);
    });

    it("cada cambio queda en la auditoría con el alcance y sin los parámetros", async () => {
      await call("put", "/admin/difficulty-rules/MISSING_REQUIRED", {
        courseId: 7,
        enabled: true,
        params: { minMissing: 3 },
      }).expect(200);
      await call("delete", "/admin/difficulty-rules/MISSING_REQUIRED?courseId=7").expect(204);

      expect(audit.filter((e) => e.action.startsWith("rules."))).toEqual([
        expect.objectContaining({
          action: "rules.update",
          resourceId: "MISSING_REQUIRED",
          courseId: 7,
          metadata: { scope: "course", enabled: true },
        }),
        expect.objectContaining({
          action: "rules.reset",
          resourceId: "MISSING_REQUIRED",
          metadata: { scope: "course" },
        }),
      ]);
    });
  });
});
