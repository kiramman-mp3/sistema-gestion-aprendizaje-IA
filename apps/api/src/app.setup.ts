import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "./config/env";

export const API_PREFIX = "api/v1";

/** Configuración compartida por `main.ts` y las pruebas e2e. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();

  // El navegador llama a la API desde las páginas de Moodle. Solo se aceptan los orígenes
  // configurados; no se usan cookies, la identidad viaja en el token del plugin.
  const origins = app.get(ConfigService<Env, true>).get("CORS_ORIGINS", { infer: true });
  app.enableCors({
    origin: origins,
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "Accept"],
    maxAge: 600,
  });
}
