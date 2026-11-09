import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verificación de los JWT que firma el plugin de Moodle (ADR-006). Solo se acepta HS256: el algoritmo
 * se fija aquí y nunca se toma del encabezado, para evitar ataques de confusión de algoritmo.
 */

export type TokenErrorCode = "TOKEN_INVALID" | "TOKEN_EXPIRED";

export class TokenError extends Error {
  constructor(
    readonly code: TokenErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TokenError";
  }
}

export interface PluginTokenClaims {
  moodleUserId: number;
  courseId: number;
  jti: string;
  /** Segundos epoch. */
  expiresAt: number;
}

export interface VerifyOptions {
  secret: string;
  issuer: string;
  audience: string;
  /** Vida máxima permitida (exp − iat) en segundos. */
  maxLifetimeSeconds: number;
  /** Tolerancia de reloj entre Moodle y el backend, en segundos. */
  clockToleranceSeconds: number;
  /** Segundos epoch; inyectable para pruebas. */
  now?: number;
}

const JTI_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function verifyPluginToken(token: string, options: VerifyOptions): PluginTokenClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw invalid("El token no tiene tres partes.");
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

  const header = decodeJson(encodedHeader);
  if (header.alg !== "HS256" || (header.typ !== undefined && header.typ !== "JWT")) {
    throw invalid("Algoritmo no permitido.");
  }

  const expected = createHmac("sha256", options.secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  const received = Buffer.from(encodedSignature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw invalid("Firma inválida.");
  }

  const claims = decodeJson(encodedPayload);
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options.clockToleranceSeconds;

  if (normalizeUrl(claims.iss) !== normalizeUrl(options.issuer)) throw invalid("Emisor inválido.");
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(options.audience)) throw invalid("Audiencia inválida.");

  const iat = claims.iat;
  const exp = claims.exp;
  if (!isEpoch(iat) || !isEpoch(exp)) throw invalid("Faltan iat o exp.");
  if (iat > now + tolerance) throw invalid("Token emitido en el futuro.");
  if (exp - iat > options.maxLifetimeSeconds) throw invalid("Vida del token demasiado larga.");
  if (exp <= now - tolerance) throw new TokenError("TOKEN_EXPIRED", "Token expirado.");

  const moodleUserId = toPositiveInt(claims.sub);
  const courseId = toPositiveInt(claims.courseid);
  if (moodleUserId === null || courseId === null) throw invalid("sub o courseid inválidos.");
  if (typeof claims.jti !== "string" || !JTI_PATTERN.test(claims.jti)) {
    throw invalid("jti inválido.");
  }

  return { moodleUserId, courseId, jti: claims.jti, expiresAt: exp };
}

function decodeJson(segment: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw invalid("Segmento del token mal formado.");
  }
}

function invalid(message: string): TokenError {
  return new TokenError("TOKEN_INVALID", message);
}

function isEpoch(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function toPositiveInt(value: unknown): number | null {
  const n = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
}

function normalizeUrl(value: unknown): string {
  return typeof value === "string" ? value.replace(/\/+$/, "") : "";
}
