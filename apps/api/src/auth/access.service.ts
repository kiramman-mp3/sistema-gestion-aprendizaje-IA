import { Injectable, Logger } from "@nestjs/common";
import { MoodleService } from "../integrations/moodle/moodle.service";
import { courseAccessSchema, type CourseAccess } from "../integrations/moodle/moodle.types";
import { RedisService } from "../redis/redis.service";

/**
 * Tiempo que se reutiliza la respuesta de Moodle. Un cambio de rol en Moodle tarda como máximo este
 * tiempo en reflejarse (RF-02 pide ≤ 5 minutos).
 */
export const ACCESS_CACHE_TTL_SECONDS = 120;

/** Capacidades del usuario en un curso, con caché corta en Redis (ADR-007). */
@Injectable()
export class AccessService {
  private readonly logger = new Logger(AccessService.name);

  constructor(
    private readonly moodle: MoodleService,
    private readonly redis: RedisService,
  ) {}

  async getAccess(moodleUserId: number, courseId: number): Promise<CourseAccess> {
    const key = `access:${moodleUserId}:${courseId}`;

    const cached = await this.readCache(key);
    if (cached) return cached;

    // Si Moodle no responde, el error se propaga: sin permisos verificados no hay acceso.
    const access = await this.moodle.checkAccess(moodleUserId, courseId);
    await this.writeCache(key, access);
    return access;
  }

  /** La caché es una optimización: si Redis falla, se consulta Moodle directamente. */
  private async readCache(key: string): Promise<CourseAccess | null> {
    try {
      if (this.redis.client.status === "wait") await this.redis.client.connect();
      const raw = await this.redis.client.get(key);
      if (!raw) return null;
      const parsed = courseAccessSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch (error) {
      this.logger.warn(`No se pudo leer la caché de acceso: ${String(error)}`);
      return null;
    }
  }

  private async writeCache(key: string, access: CourseAccess): Promise<void> {
    try {
      await this.redis.client.set(key, JSON.stringify(access), "EX", ACCESS_CACHE_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(`No se pudo escribir la caché de acceso: ${String(error)}`);
    }
  }
}
