import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { MoodleError } from "../integrations/moodle/moodle.errors";
import { AccessService } from "./access.service";
import type { AuthenticatedRequest } from "./auth-context";
import { IS_PUBLIC } from "./public.decorator";
import { REQUIRED_CAPABILITIES, type AssistantCapability } from "./require-capability.decorator";

/**
 * Segundo guard global, después de PluginAuthGuard. Pregunta a Moodle qué puede hacer el usuario en el
 * curso del token (RF-02) y aplica tres reglas:
 * 1. Sin `local/ai_assistant:use` en el curso, no hay acceso a ninguna ruta.
 * 2. Un `:courseId` en la ruta debe ser el mismo curso del token (SEC-01).
 * 3. Las capacidades pedidas con @RequireCapability deben estar concedidas.
 */
@Injectable()
export class CourseAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = request.auth;
    if (!auth) throw new Error("CourseAccessGuard requiere PluginAuthGuard antes.");

    const routeCourseId = request.params?.courseId;
    if (routeCourseId !== undefined && Number(routeCourseId) !== auth.courseId) {
      throw forbidden("FORBIDDEN_COURSE", "El token no corresponde a este curso.");
    }

    let access;
    try {
      access = await this.access.getAccess(auth.moodleUserId, auth.courseId);
    } catch (error) {
      if (error instanceof MoodleError) {
        throw new ServiceUnavailableException({
          code: "MOODLE_UNAVAILABLE",
          message: "No se pudieron verificar los permisos en Moodle.",
        });
      }
      throw error;
    }

    if (!access.courseexists || !access.active || !access.capabilities.use) {
      throw forbidden("FORBIDDEN_COURSE", "Sin permiso para usar el asistente en este curso.");
    }

    const required =
      this.reflector.getAllAndOverride<AssistantCapability[]>(REQUIRED_CAPABILITIES, targets) ?? [];
    const missing = required.filter((capability) => !access.capabilities[capability]);
    if (missing.length > 0) {
      throw forbidden("FORBIDDEN_CAPABILITY", `Falta la capacidad: ${missing.join(", ")}.`);
    }

    request.auth = { ...auth, roles: access.roles, capabilities: access.capabilities };
    return true;
  }
}

function forbidden(code: string, message: string): ForbiddenException {
  return new ForbiddenException({ code, message });
}
