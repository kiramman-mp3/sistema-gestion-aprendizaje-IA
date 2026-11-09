import type { INestApplication } from "@nestjs/common";

export const API_PREFIX = "api/v1";

/** Configuración compartida por `main.ts` y las pruebas e2e. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
}
