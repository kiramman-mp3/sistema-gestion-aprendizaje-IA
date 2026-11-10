import type { INestApplication } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { ConfigService } from "@nestjs/config";
import type { Env } from "./config/env";

export const API_PREFIX = "api/v1";

/**
 * Cabeceras de seguridad de una API que solo devuelve JSON o flujos de eventos: no se interpreta como
 * documento, no se incrusta, no se guarda en cachés y no envía el origen al navegar. El proxy de producción
 * añade además HSTS (infra/docker/caddy/Caddyfile).
 */
export function securityHeaders(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cache-Control", "no-store");
  next();
}

/** Configuración compartida por `main.ts` y las pruebas e2e. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  // No revela con qué framework está hecho el servidor.
  (app.getHttpAdapter().getInstance() as { disable: (name: string) => void }).disable(
    "x-powered-by",
  );
  app.use(securityHeaders);
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
