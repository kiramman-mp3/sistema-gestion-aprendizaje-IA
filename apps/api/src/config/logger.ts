import type { Params } from "nestjs-pino";
import type { Env } from "./env";

/**
 * Rutas que nunca deben aparecer en los logs (SEC-09): credenciales, tokens y cuerpos de petición,
 * que pueden traer mensajes del chat o datos de estudiantes.
 */
export const REDACTED_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["idempotency-key"]',
  "req.body",
  "res.headers['set-cookie']",
  "*.token",
  "*.wstoken",
  "*.password",
  "*.secret",
];

export function buildLoggerParams(env: Pick<Env, "NODE_ENV" | "LOG_LEVEL">): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      redact: { paths: REDACTED_PATHS, censor: "[REDACTED]" },
      ...(env.NODE_ENV === "development"
        ? { transport: { target: "pino-pretty", options: { singleLine: true } } }
        : {}),
      autoLogging: { ignore: (req) => req.url?.endsWith("/health") ?? false },
    },
  };
}
