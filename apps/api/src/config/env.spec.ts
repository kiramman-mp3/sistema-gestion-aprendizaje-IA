import { validateEnv } from "./env";

describe("validateEnv", () => {
  it("aplica valores por defecto", () => {
    const env = validateEnv({});
    expect(env).toMatchObject({ NODE_ENV: "development", PORT: 3000, LOG_LEVEL: "info" });
  });

  it("convierte el puerto a número", () => {
    expect(validateEnv({ PORT: "4000" }).PORT).toBe(4000);
  });

  it("rechaza URLs inválidas indicando la variable", () => {
    expect(() => validateEnv({ MOODLE_BASE_URL: "no-es-url" })).toThrow(/MOODLE_BASE_URL/);
  });

  it("exige un secreto JWT de al menos 32 caracteres", () => {
    expect(() => validateEnv({ PLUGIN_JWT_SECRET: "corto" })).toThrow(/PLUGIN_JWT_SECRET/);
  });

  it("convierte CORS_ORIGINS en una lista sin barras finales", () => {
    expect(
      validateEnv({ CORS_ORIGINS: "http://localhost:8000/, https://moodle.uni.ec" }).CORS_ORIGINS,
    ).toEqual(["http://localhost:8000", "https://moodle.uni.ec"]);
    expect(validateEnv({}).CORS_ORIGINS).toEqual([]);
  });

  it("rechaza orígenes CORS inválidos", () => {
    expect(() => validateEnv({ CORS_ORIGINS: "*" })).toThrow(/CORS_ORIGINS/);
  });

  it("no incluye el valor del secreto en el mensaje de error", () => {
    expect(() => validateEnv({ PLUGIN_JWT_SECRET: "secreto-filtrable" })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("secreto-filtrable") }),
    );
  });

  it("acepta clamd solo por tcp", () => {
    expect(validateEnv({ CLAMAV_URL: "tcp://clamav:3310" }).CLAMAV_URL).toBe("tcp://clamav:3310");
    expect(() => validateEnv({ CLAMAV_URL: "http://clamav:3310" })).toThrow(/CLAMAV_URL/);
  });

  it("exige el antivirus en producción", () => {
    expect(() => validateEnv({ NODE_ENV: "production" })).toThrow(/CLAMAV_URL/);
    expect(validateEnv({ NODE_ENV: "production", CLAMAV_URL: "tcp://clamav:3310" }).NODE_ENV).toBe(
      "production",
    );
  });

  it("usa 30 días de retención y var/storage por defecto", () => {
    expect(validateEnv({})).toMatchObject({
      SYLLABUS_RETENTION_DAYS: 30,
      STORAGE_DIR: "var/storage",
    });
  });
  describe("proveedor de IA", () => {
    it("sin configurar no hay proveedor y los topes tienen valor por defecto", () => {
      const env = validateEnv({});
      expect(env.AI_PROVIDER).toBeUndefined();
      expect(env).toMatchObject({
        AI_TIMEOUT_MS: 60_000,
        AI_MAX_INPUT_TOKENS: 32_000,
        AI_MAX_OUTPUT_TOKENS: 8_192,
      });
    });

    it("trata las variables vacías del .env como no configuradas", () => {
      const env = validateEnv({ AI_PROVIDER: "", AI_API_KEY: "" });
      expect(env.AI_PROVIDER).toBeUndefined();
      expect(env.AI_API_KEY).toBeUndefined();
    });

    it("acepta el proveedor simulado y rechaza uno desconocido", () => {
      expect(validateEnv({ AI_PROVIDER: "mock" }).AI_PROVIDER).toBe("mock");
      expect(() => validateEnv({ AI_PROVIDER: "otro" })).toThrow(/AI_PROVIDER/);
    });

    it("no permite el proveedor simulado en producción", () => {
      expect(() =>
        validateEnv({
          NODE_ENV: "production",
          CLAMAV_URL: "tcp://clamav:3310",
          AI_PROVIDER: "mock",
        }),
      ).toThrow(/AI_PROVIDER/);
    });
  });
});
