import { z } from "zod";

/**
 * Variables de entorno del backend. Se validan al arrancar: si falta algo obligatorio, la aplicación
 * no inicia. Los secretos se marcan como opcionales hasta el sprint en que se usan.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.url().optional(),
  REDIS_URL: z.url().optional(),
  MOODLE_BASE_URL: z.url().optional(),
  MOODLE_TOKEN: z.string().min(1).optional(),
  MOODLE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  PLUGIN_JWT_SECRET: z.string().min(32).optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Usado por `ConfigModule`; el mensaje de error no incluye los valores, solo los nombres. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const fields = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuración inválida: ${fields}`);
  }
  return result.data;
}
