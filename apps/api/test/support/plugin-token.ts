import { createHmac, randomBytes } from "node:crypto";

export const TEST_SECRET = "test-secret-with-at-least-32-characters!";
export const TEST_ISSUER = "http://moodle.test";

/** Firma un token como lo hace el plugin (HS256). Permite alterar cualquier claim o encabezado. */
export function signPluginToken(
  overrides: Record<string, unknown> = {},
  options: { secret?: string; header?: Record<string, unknown> } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = options.header ?? { typ: "JWT", alg: "HS256" };
  const payload = {
    iss: TEST_ISSUER,
    aud: "smart-lms-api",
    sub: "42",
    courseid: 7,
    iat: now,
    exp: now + 300,
    jti: randomBytes(16).toString("hex"),
    ...overrides,
  };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode(header)}.${encode(payload)}`;
  const signature = createHmac("sha256", options.secret ?? TEST_SECRET)
    .update(unsigned)
    .digest("base64url");
  return `${unsigned}.${signature}`;
}
