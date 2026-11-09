import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

/** Identidad verificada del usuario que hace la petición. */
export interface AuthContext {
  moodleUserId: number;
  courseId: number;
}

export type AuthenticatedRequest = Request & { auth?: AuthContext };

/** Inyecta en el controlador la identidad que dejó el guard. */
export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.auth) throw new Error("Ruta sin PluginAuthGuard: no hay contexto de autenticación.");
  return request.auth;
});
