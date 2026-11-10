import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import type { Response } from "express";
import { AuditService } from "../audit/audit.service";
import type { Env } from "../config/env";
import { RedisService } from "../redis/redis.service";
import type { AuthenticatedRequest } from "./auth-context";
import { IS_PUBLIC } from "./public.decorator";

/** Duración de la ventana de conteo. */
const WINDOW_SECONDS = 60;

/** Cuenta las peticiones de un usuario en una ventana; devuelve cuántas lleva, contando la actual. */
export abstract class RateLimitStore {
  abstract hit(key: string, windowSeconds: number): Promise<number>;
}

@Injectable()
export class RedisRateLimitStore extends RateLimitStore {
  constructor(private readonly redis: RedisService) {
    super();
  }

  async hit(key: string, windowSeconds: number): Promise<number> {
    if (this.redis.client.status === "wait") await this.redis.client.connect();
    const count = await this.redis.client.incr(key);
    // El primer golpe de la ventana fija su vencimiento; así un contador abandonado desaparece solo.
    if (count === 1) await this.redis.client.expire(key, windowSeconds * 2);
    return count;
  }
}

/** Implementación en memoria para pruebas. */
export class InMemoryRateLimitStore extends RateLimitStore {
  private readonly counts = new Map<string, number>();

  async hit(key: string): Promise<number> {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return count;
  }
}

/**
 * Limita las peticiones por usuario de Moodle y minuto (defensa en profundidad, OWASP API4). Corre después de
 * verificar el token y antes de preguntar a Moodle por los permisos, así una avalancha de peticiones no se
 * convierte en una avalancha de llamadas a Moodle.
 *
 * No sustituye al límite de uso y costo de IA por docente (RNF-07), que cuenta consumo del proveedor.
 * Si Redis no responde, deja pasar la petición y lo registra: el token ya se aceptó (la verificación del
 * `jti` sí falla cerrada) y no se corta el servicio por un contador.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly limit: number;

  constructor(
    private readonly reflector: Reflector,
    private readonly store: RateLimitStore,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.limit = config.get("RATE_LIMIT_PER_MINUTE", { infer: true });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.limit === 0) return true;
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = request.auth;
    if (!auth) return true;

    const now = Date.now();
    const window = Math.floor(now / (WINDOW_SECONDS * 1000));
    let count: number;
    try {
      count = await this.store.hit(`rl:${auth.moodleUserId}:${window}`, WINDOW_SECONDS);
    } catch (error) {
      this.logger.warn(`No se pudo contar la petición: ${String(error)}`);
      return true;
    }
    if (count <= this.limit) return true;

    // Se audita solo el primer rechazo de cada ventana, para no llenar el registro durante un ataque.
    if (count === this.limit + 1) {
      await this.audit.record({
        action: "rate.limited",
        outcome: "DENIED",
        actorMoodleId: auth.moodleUserId,
        courseId: auth.courseId,
        metadata: { limit: this.limit, method: request.method, path: request.path },
      });
    }
    const retryAfter = Math.max(1, Math.ceil(((window + 1) * WINDOW_SECONDS * 1000 - now) / 1000));
    context.switchToHttp().getResponse<Response>().setHeader("Retry-After", String(retryAfter));
    throw new HttpException(
      { code: "RATE_LIMITED", message: "Demasiadas peticiones. Inténtalo de nuevo en un momento." },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
