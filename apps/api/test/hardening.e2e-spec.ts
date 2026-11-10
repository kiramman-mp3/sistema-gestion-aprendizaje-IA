import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AuditService, type AuditEntry } from "../src/audit/audit.service";
import { AccessService } from "../src/auth/access.service";
import { InMemoryJtiStore, JtiStore } from "../src/auth/jti-store";
import { InMemoryRateLimitStore, RateLimitStore } from "../src/auth/rate-limit.guard";
import type { CourseAccess } from "../src/integrations/moodle/moodle.types";
import { signPluginToken, TEST_ISSUER, TEST_SECRET } from "./support/plugin-token";

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

describe("Endurecimiento del backend (e2e)", () => {
  let app: INestApplication;
  const audit: AuditEntry[] = [];

  beforeAll(async () => {
    process.env.LOG_LEVEL = "fatal";
    process.env.PLUGIN_JWT_SECRET = TEST_SECRET;
    process.env.MOODLE_BASE_URL = TEST_ISSUER;
    process.env.RATE_LIMIT_PER_MINUTE = "3";
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
      .useValue({ record: async (entry: AuditEntry) => void audit.push(entry) })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.RATE_LIMIT_PER_MINUTE;
  });

  const session = (userId: number) =>
    request(app.getHttpServer())
      .get("/api/v1/session")
      .set("Authorization", `Bearer ${signPluginToken({ sub: String(userId) })}`);

  describe("cabeceras de seguridad (OWASP A05)", () => {
    it("toda respuesta lleva las cabeceras y no revela el framework", async () => {
      const res = await request(app.getHttpServer()).get("/api/v1/health");

      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-powered-by"]).toBeUndefined();
    });

    it("también las respuestas de error", async () => {
      const res = await request(app.getHttpServer()).get("/api/v1/session").expect(401);

      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["cache-control"]).toBe("no-store");
    });
  });

  describe("límite de peticiones (OWASP API4)", () => {
    it("responde 429 con Retry-After al pasar el límite y lo audita una vez", async () => {
      for (let i = 0; i < 3; i++) await session(100).expect(200);

      const blocked = await session(100).expect(429);
      await session(100).expect(429);

      expect(blocked.body.code).toBe("RATE_LIMITED");
      expect(Number(blocked.headers["retry-after"])).toBeGreaterThanOrEqual(1);
      expect(audit.filter((entry) => entry.action === "rate.limited")).toHaveLength(1);
    });

    it("otro usuario no se ve afectado", async () => {
      await session(200).expect(200);
    });
  });
});
