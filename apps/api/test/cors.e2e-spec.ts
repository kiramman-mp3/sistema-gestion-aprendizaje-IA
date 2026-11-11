import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

describe("CORS (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.LOG_LEVEL = "fatal";
    process.env.CORS_ORIGINS = "http://moodle.test";
    // ConfigModule valida el entorno al importar AppModule: se importa después de definirlo.
    const { AppModule } = await import("../src/app.module.js");
    const { configureApp } = await import("../src/app.setup.js");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("permite la petición previa desde el origen de Moodle con el encabezado Authorization", async () => {
    const res = await request(app.getHttpServer())
      .options("/api/v1/session")
      .set("Origin", "http://moodle.test")
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "authorization")
      .expect(204);

    expect(res.headers["access-control-allow-origin"]).toBe("http://moodle.test");
    expect(res.headers["access-control-allow-headers"]).toMatch(/Authorization/i);
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("deja que el navegador lea Retry-After en las respuestas", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/session")
      .set("Origin", "http://moodle.test");

    expect(res.headers["access-control-expose-headers"]).toMatch(/Retry-After/i);
  });

  it("no autoriza otros orígenes", async () => {
    const res = await request(app.getHttpServer())
      .options("/api/v1/session")
      .set("Origin", "http://malicioso.test")
      .set("Access-Control-Request-Method", "GET");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
