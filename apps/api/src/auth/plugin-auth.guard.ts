import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { AuditService } from "../audit/audit.service";
import type { Env } from "../config/env";
import type { AuthenticatedRequest } from "./auth-context";
import { JtiStore } from "./jti-store";
import { TokenError, verifyPluginToken } from "./plugin-token";
import { IS_PUBLIC } from "./public.decorator";

export const TOKEN_AUDIENCE = "smart-lms-api";
export const MAX_TOKEN_LIFETIME_SECONDS = 300;
export const CLOCK_TOLERANCE_SECONDS = 30;

/**
 * Guard global: toda ruta exige un JWT válido y no usado del plugin, salvo las marcadas con @Public().
 * Falla cerrado: sin secreto configurado o sin registro de jti, rechaza la petición.
 */
@Injectable()
export class PluginAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService<Env, true>,
    private readonly jtiStore: JtiStore,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearer(request.headers.authorization);
    if (!token) throw await this.deny(request, "TOKEN_MISSING", "Falta el token del plugin.");

    const secret = this.config.get("PLUGIN_JWT_SECRET", { infer: true });
    const issuer = this.config.get("MOODLE_BASE_URL", { infer: true });
    if (!secret || !issuer) {
      throw new ServiceUnavailableException({
        code: "AUTH_NOT_CONFIGURED",
        message: "La autenticación del plugin no está configurada.",
      });
    }

    let claims;
    try {
      claims = verifyPluginToken(token, {
        secret,
        issuer,
        audience: TOKEN_AUDIENCE,
        maxLifetimeSeconds: MAX_TOKEN_LIFETIME_SECONDS,
        clockToleranceSeconds: CLOCK_TOLERANCE_SECONDS,
      });
    } catch (error) {
      if (error instanceof TokenError) throw await this.deny(request, error.code, error.message);
      throw error;
    }

    // El jti se recuerda hasta que el token ya no podría ser válido.
    const ttl = Math.max(
      1,
      claims.expiresAt - Math.floor(Date.now() / 1000) + CLOCK_TOLERANCE_SECONDS,
    );
    let fresh: boolean;
    try {
      fresh = await this.jtiStore.markUsed(claims.jti, ttl);
    } catch {
      throw new ServiceUnavailableException({
        code: "AUTH_UNAVAILABLE",
        message: "No se pudo verificar el token.",
      });
    }
    if (!fresh) {
      throw await this.deny(
        request,
        "TOKEN_REPLAYED",
        "El token ya fue usado.",
        claims.moodleUserId,
      );
    }

    request.auth = { moodleUserId: claims.moodleUserId, courseId: claims.courseId };
    return true;
  }

  /** Registra el rechazo (SEC-03, RF-19) y devuelve la excepción a lanzar. */
  private async deny(
    request: AuthenticatedRequest,
    code: string,
    message: string,
    actorMoodleId?: number,
  ): Promise<UnauthorizedException> {
    await this.audit.record({
      action: "auth.denied",
      outcome: "DENIED",
      ...(actorMoodleId !== undefined ? { actorMoodleId } : {}),
      metadata: { code, method: request.method, path: request.path },
    });
    return new UnauthorizedException({ code, message });
  }
}

function extractBearer(header: string | undefined): string | null {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}
