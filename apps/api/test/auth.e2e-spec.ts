import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";
import { InMemoryJtiStore, JtiStore } from "../src/auth/jti-store";
import { signPluginToken, TEST_ISSUER, TEST_SECRET } from "./support/plugin-token";

describe("Autenticación del plugin (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.LOG_LEVEL = "fatal";
    process.env.PLUGIN_JWT_SECRET = TEST_SECRET;
    process.env.MOODLE_BASE_URL = TEST_ISSUER;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JtiStore)
      .useValue(new InMemoryJtiStore())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const session = () => request(app.getHttpServer()).get("/api/v1/session");

  it("devuelve la identidad con un token válido", async () => {
    const res = await session().set("Authorization", `Bearer ${signPluginToken()}`).expect(200);
    expect(res.body).toEqual({ moodleUserId: 42, courseId: 7 });
  });

  it("SEC-03: rechaza la petición sin token", async () => {
    const res = await session().expect(401);
    expect(res.body.code).toBe("TOKEN_MISSING");
  });

  it("SEC-03: rechaza un token con firma inválida", async () => {
    const token = signPluginToken({}, { secret: "otro-secreto-de-al-menos-32-caracteres!!" });
    const res = await session().set("Authorization", `Bearer ${token}`).expect(401);
    expect(res.body.code).toBe("TOKEN_INVALID");
  });

  it("SEC-03: rechaza un token expirado", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signPluginToken({ iat: now - 600, exp: now - 300 });
    const res = await session().set("Authorization", `Bearer ${token}`).expect(401);
    expect(res.body.code).toBe("TOKEN_EXPIRED");
  });

  it("SEC-03: rechaza la reutilización de un token", async () => {
    const token = signPluginToken();
    await session().set("Authorization", `Bearer ${token}`).expect(200);
    const res = await session().set("Authorization", `Bearer ${token}`).expect(401);
    expect(res.body.code).toBe("TOKEN_REPLAYED");
  });

  it("mantiene /health público", async () => {
    await request(app.getHttpServer()).get("/api/v1/health").expect(200);
  });
});
