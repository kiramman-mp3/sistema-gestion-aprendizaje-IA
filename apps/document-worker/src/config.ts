import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Carpeta del backend: una ruta relativa en STORAGE_DIR se interpreta igual que en el backend. */
const API_DIR = fileURLToPath(new URL("../../api/", import.meta.url));

const configSchema = z.object({
  REDIS_URL: z.url(),
  STORAGE_DIR: z.string().min(1).default("var/storage"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
});

export interface WorkerConfig {
  redisUrl: string;
  storageDir: string;
  concurrency: number;
}

/** Lee y valida el entorno. El error nombra las variables, nunca sus valores. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const fields = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuración inválida: ${fields}`);
  }
  const { REDIS_URL, STORAGE_DIR, WORKER_CONCURRENCY } = result.data;
  return {
    redisUrl: REDIS_URL,
    storageDir: isAbsolute(STORAGE_DIR) ? STORAGE_DIR : resolve(API_DIR, STORAGE_DIR),
    concurrency: WORKER_CONCURRENCY,
  };
}
