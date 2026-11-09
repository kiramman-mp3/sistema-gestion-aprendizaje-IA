import { signPluginToken, TEST_ISSUER, TEST_SECRET } from "../../test/support/plugin-token";
import { verifyPluginToken, type VerifyOptions } from "./plugin-token";

const NOW = 1_800_000_000;
const options: VerifyOptions = {
  secret: TEST_SECRET,
  issuer: TEST_ISSUER,
  audience: "smart-lms-api",
  maxLifetimeSeconds: 300,
  clockToleranceSeconds: 30,
  now: NOW,
};
const token = (overrides: Record<string, unknown> = {}, extra = {}) =>
  signPluginToken({ iat: NOW, exp: NOW + 300, ...overrides }, extra);

describe("verifyPluginToken", () => {
  it("acepta un token válido y devuelve la identidad", () => {
    const claims = verifyPluginToken(token({ jti: "a".repeat(32) }), options);
    expect(claims).toEqual({
      moodleUserId: 42,
      courseId: 7,
      jti: "a".repeat(32),
      expiresAt: NOW + 300,
    });
  });

  it("acepta el emisor con o sin barra final", () => {
    expect(() => verifyPluginToken(token({ iss: `${TEST_ISSUER}/` }), options)).not.toThrow();
  });

  it.each([
    [
      "firma con otro secreto",
      () => token({}, { secret: "otro-secreto-de-al-menos-32-caracteres!!" }),
    ],
    ["algoritmo none", () => token({}, { header: { alg: "none", typ: "JWT" } })],
    ["algoritmo HS512", () => token({}, { header: { alg: "HS512", typ: "JWT" } })],
    ["emisor distinto", () => token({ iss: "http://otro-moodle.test" })],
    ["audiencia distinta", () => token({ aud: "otra-api" })],
    ["vida mayor a 5 minutos", () => token({ exp: NOW + 3600 })],
    ["emitido en el futuro", () => token({ iat: NOW + 120, exp: NOW + 300 })],
    ["sub no numérico", () => token({ sub: "admin" })],
    ["courseid ausente", () => token({ courseid: undefined })],
    ["jti ausente", () => token({ jti: undefined })],
    ["texto que no es un JWT", () => "no-es-un-token"],
  ])("rechaza %s como TOKEN_INVALID", (_case, build) => {
    expect(() => verifyPluginToken(build(), options)).toThrow(
      expect.objectContaining({ code: "TOKEN_INVALID" }),
    );
  });

  it("rechaza un token con la carga alterada aunque conserve la firma", () => {
    const [h, , s] = token().split(".");
    const tampered = Buffer.from(JSON.stringify({ sub: "1", courseid: 1 })).toString("base64url");
    expect(() => verifyPluginToken(`${h}.${tampered}.${s}`, options)).toThrow(
      expect.objectContaining({ code: "TOKEN_INVALID" }),
    );
  });

  it("rechaza un token expirado fuera de la tolerancia como TOKEN_EXPIRED", () => {
    expect(() => verifyPluginToken(token({ iat: NOW - 400, exp: NOW - 100 }), options)).toThrow(
      expect.objectContaining({ code: "TOKEN_EXPIRED" }),
    );
  });

  it("acepta un token recién expirado dentro de la tolerancia de reloj", () => {
    expect(() =>
      verifyPluginToken(token({ iat: NOW - 310, exp: NOW - 10 }), options),
    ).not.toThrow();
  });
});
