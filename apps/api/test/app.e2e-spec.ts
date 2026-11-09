import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";

describe("API (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.LOG_LEVEL = "fatal";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/v1/health responde con la forma del contrato", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/health").expect(200);
    expect(res.body).toEqual({ status: "ok", dependencies: {} });
  });

  it("las rutas inexistentes devuelven el formato de error del contrato", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/no-existe").expect(404);
    expect(res.body).toEqual({ code: "NOT_FOUND", message: expect.any(String) });
  });

  it("no expone rutas fuera del prefijo", async () => {
    await request(app.getHttpServer()).get("/health").expect(404);
  });
});
