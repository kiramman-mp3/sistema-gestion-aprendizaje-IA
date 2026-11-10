import { z } from "zod";

/**
 * Variables de entorno del backend. Se validan al arrancar: si falta algo obligatorio, la aplicación
 * no inicia. Los secretos se marcan como opcionales hasta el sprint en que se usan.
 */
/** `AI_PROVIDER=` vacío en el `.env` equivale a no configurar la variable. */
const emptyToUndefined = (value: unknown): unknown => (value === "" ? undefined : value);

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
  /** Proveedor de IA (ADR-009). Sin valor no hay IA y las llamadas responden AI_PROVIDER_UNAVAILABLE. */
  AI_PROVIDER: z.preprocess(emptyToUndefined, z.enum(["mock"]).optional()),
  AI_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /** Tiempo máximo de una llamada al proveedor. */
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  /** Tokens estimados de entrada a partir de los cuales no se llama al proveedor. */
  AI_MAX_INPUT_TOKENS: z.coerce.number().int().positive().default(32_000),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(8_192),
  /** Días que se conserva una conversación con el asistente. Provisional hasta la política D-08. */
  AI_CONVERSATION_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  /** Días que se conservan los snapshots de indicadores (ADR-018). Provisional hasta la política D-08. */
  ANALYTICS_SNAPSHOT_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
  /** Tope de uso de IA por docente en 24 horas (RNF-07): mensajes y tokens (entrada + salida). */
  AI_DAILY_MESSAGES_PER_TEACHER: z.coerce.number().int().positive().default(200),
  /** Recomendaciones pedagógicas por docente en 24 horas. */
  AI_DAILY_RECOMMENDATIONS_PER_TEACHER: z.coerce.number().int().positive().default(50),
  AI_DAILY_TOKENS_PER_TEACHER: z.coerce.number().int().positive().default(500_000),
  /** Clave con la que se derivan los seudónimos de estudiantes (ADR-010). Obligatoria en producción con IA. */
  PSEUDONYM_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
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
  if (env.NODE_ENV === "production" && env.AI_PROVIDER && !env.PSEUDONYM_SECRET) {
    ctx.addIssue({
      code: "custom",
      path: ["PSEUDONYM_SECRET"],
      message: "es obligatoria en producción con IA: sin ella los seudónimos serían predecibles",
    });
  }
  if (env.NODE_ENV === "production" && env.AI_PROVIDER === "mock") {
    ctx.addIssue({
      code: "custom",
      path: ["AI_PROVIDER"],
      message: "el proveedor simulado no puede usarse en producción",
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
