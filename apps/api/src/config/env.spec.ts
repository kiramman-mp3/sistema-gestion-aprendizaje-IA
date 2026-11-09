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

  it("no incluye el valor del secreto en el mensaje de error", () => {
    expect(() => validateEnv({ PLUGIN_JWT_SECRET: "secreto-filtrable" })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("secreto-filtrable") }),
    );
  });
});
