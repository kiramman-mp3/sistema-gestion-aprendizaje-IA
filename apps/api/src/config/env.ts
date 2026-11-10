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
  /** Orígenes del navegador que pueden llamar a la API (el wwwroot de Moodle), separados por comas. */
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim().replace(/\/+$/, ""))
        .filter(Boolean),
    )
    .pipe(z.array(z.url())),
  /** Carpeta de los archivos subidos; el worker documental la monta en solo lectura. */
  STORAGE_DIR: z.string().min(1).default("var/storage"),
  /** Días que se conserva el archivo original de un sílabo (RNF-08, propuesta de 30 días). */
  SYLLABUS_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  /** Peticiones por usuario y minuto antes de responder 429 (OWASP API4). 0 desactiva el límite. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).default(120),
  /** clamd para el análisis antivirus, por ejemplo `tcp://localhost:3310`. Obligatorio en producción. */
  CLAMAV_URL: z.url({ protocol: /^tcp$/ }).optional(),
  CLAMAV_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
});

export type Env = z.infer<typeof envSchema>;

/** Reglas que dependen de varias variables. */
const envRules = envSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV === "production" && !env.CLAMAV_URL) {
    ctx.addIssue({
      code: "custom",
      path: ["CLAMAV_URL"],
      message: "es obligatoria en producción: los archivos subidos deben pasar por el antivirus",
    });
  }
});

/** Usado por `ConfigModule`; el mensaje de error no incluye los valores, solo los nombres. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envRules.safeParse(raw);
  if (!result.success) {
    const fields = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuración inválida: ${fields}`);
  }
  return result.data;
}
