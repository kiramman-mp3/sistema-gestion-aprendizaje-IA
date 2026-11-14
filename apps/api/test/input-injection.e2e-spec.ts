import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AuditService } from "../src/audit/audit.service";
import { AccessService } from "../src/auth/access.service";
import { InMemoryJtiStore, JtiStore } from "../src/auth/jti-store";
import { InMemoryRateLimitStore, RateLimitStore } from "../src/auth/rate-limit.guard";
import { PrismaService } from "../src/database/prisma.service";
import type { CourseAccess } from "../src/integrations/moodle/moodle.types";
import { signPluginToken, TEST_ISSUER, TEST_SECRET } from "./support/plugin-token";

const fakeAccess = {
  getAccess: async (userId: number, courseId: number): Promise<CourseAccess> => ({
    userid: userId,
    courseid: courseId,
    courseexists: true,
    active: true,
    roles: ["manager"],
    capabilities: { use: true, publish: true, viewanalytics: true, admin: true },
  }),
};

/**
 * Base simulada: registra cada llamada y responde "no encontrado". Si una entrada maliciosa aparece en estos
 * argumentos, llegó a la capa de datos sin pasar por la validación.
 */
function recordingPrisma(calls: unknown[]) {
  const handler: ProxyHandler<() => void> = {
    get: (_target, prop) => {
      if (prop === "then") return undefined;
      return new Proxy(() => undefined, handler);
    },
    apply: (_target, _this, args) => {
      calls.push(args);
      return Promise.resolve(null);
    },
  };
  return new Proxy(() => undefined, handler);
}

// Cargas típicas de inyección SQL, de operadores, de rutas y de scripts.
const PAYLOADS = [
  "1' OR '1'='1",
  "1; DROP TABLE proposals;--",
  "../../etc/passwd",
  "<script>alert(1)</script>",
  "$where",
];

describe("SEC-08: inyección en parámetros y filtros (e2e)", () => {
  let app: INestApplication;
  const calls: unknown[] = [];
  // Cada token es de un solo uso (anti-repetición, SEC-03): uno por petición.
  const token = () => `Bearer ${signPluginToken()}`;

  beforeAll(async () => {
    process.env.LOG_LEVEL = "fatal";
    process.env.PLUGIN_JWT_SECRET = TEST_SECRET;
    process.env.MOODLE_BASE_URL = TEST_ISSUER;
    const { AppModule } = await import("../src/app.module.js");
    const { configureApp } = await import("../src/app.setup.js");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JtiStore)
      .useValue(new InMemoryJtiStore())
      .overrideProvider(RateLimitStore)
      .useValue(new InMemoryRateLimitStore())
      .overrideProvider(AccessService)
      .useValue(fakeAccess)
      .overrideProvider(AuditService)
      .useValue({ record: async () => undefined })
      .overrideProvider(PrismaService)
      .useValue(recordingPrisma(calls))
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    calls.length = 0;
  });

  const reachedData = (payload: string) => JSON.stringify(calls).includes(payload);
  const http = () => request(app.getHttpServer());

  it("control: un id válido sí llega a la base (la comprobación de abajo no es trivial)", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    await http().get(`/api/v1/proposals/${id}`).set("Authorization", token()).expect(404);

    expect(reachedData(id)).toBe(true);
  });

  describe.each(PAYLOADS)("carga %s", (payload) => {
    const encoded = encodeURIComponent(payload);

    it.each([
      ["GET", `/api/v1/syllabi/${encoded}`],
      ["GET", `/api/v1/syllabi/${encoded}/extraction`],
      ["DELETE", `/api/v1/syllabi/${encoded}`],
      ["GET", `/api/v1/proposals/${encoded}`],
      ["POST", `/api/v1/proposals/${encoded}/approve`],
      ["GET", `/api/v1/assistant/conversations/${encoded}`],
      ["POST", `/api/v1/recommendations/${encoded}/followups`],
      ["GET", `/api/v1/analytics/courses/7/students/${encoded}`],
      ["PUT", `/api/v1/courses/7/activity-mappings/${encoded}`],
      ["PUT", `/api/v1/admin/difficulty-rules/${encoded}`],
    ])("en la ruta %s %s se rechaza sin llegar a la base", async (method, path) => {
      const res = await http()
        [method.toLowerCase() as "get" | "post" | "put" | "delete"](path)
        .set("Authorization", token())
        .send({});

      expect([400, 404]).toContain(res.status);
      expect(reachedData(payload)).toBe(false);
    });

    it.each([
      `/api/v1/syllabi/00000000-0000-4000-8000-000000000001/extraction?version=${encoded}`,
      `/api/v1/analytics/courses/7/history?days=${encoded}`,
      `/api/v1/audit?action=${encoded}`,
      `/api/v1/admin/difficulty-rules?courseId=${encoded}`,
    ])("en el filtro %s se rechaza sin llegar a la base", async (path) => {
      const res = await http().get(path).set("Authorization", token());

      expect([400, 404]).toContain(res.status);
      expect(reachedData(payload)).toBe(false);
    });

    it("en el curso de la ruta no se acepta", async () => {
      const res = await http()
        .get(`/api/v1/analytics/courses/${encoded}`)
        .set("Authorization", token());

      expect([400, 403, 404]).toContain(res.status);
      expect(reachedData(payload)).toBe(false);
    });
  });

  it("un cuerpo con tipos equivocados u operadores se rechaza con 400", async () => {
    for (const body of [
      { message: { $ne: null } },
      { message: ["hola"] },
      { message: "hola", conversationId: "1' OR '1'='1" },
    ]) {
      const res = await http()
        .post("/api/v1/assistant/chat")
        .set("Authorization", token())
        .send(body);
      expect(res.status).toBe(400);
    }
    expect(reachedData("1' OR '1'='1")).toBe(false);
  });

  it("una propuesta con un sílabo que no es un id se rechaza con 400", async () => {
    const res = await http()
      .post("/api/v1/proposals")
      .set("Authorization", token())
      .send({ syllabusId: "1; DROP TABLE proposals;--" });

    expect(res.status).toBe(400);
    expect(reachedData("DROP TABLE")).toBe(false);
  });
});
