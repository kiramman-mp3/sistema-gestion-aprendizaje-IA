import { Injectable } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";

/** Registro de `jti` usados: cada token del plugin sirve para una sola petición (ADR-006). */
export abstract class JtiStore {
  /** Devuelve `true` si el jti no se había usado y queda registrado; `false` si ya se usó. */
  abstract markUsed(jti: string, ttlSeconds: number): Promise<boolean>;
}

@Injectable()
export class RedisJtiStore extends JtiStore {
  constructor(private readonly redis: RedisService) {
    super();
  }

  async markUsed(jti: string, ttlSeconds: number): Promise<boolean> {
    if (this.redis.client.status === "wait") await this.redis.client.connect();
    const result = await this.redis.client.set(`jti:${jti}`, "1", "EX", ttlSeconds, "NX");
    return result === "OK";
  }
}

/** Implementación en memoria para pruebas. */
export class InMemoryJtiStore extends JtiStore {
  private readonly used = new Set<string>();

  async markUsed(jti: string): Promise<boolean> {
    if (this.used.has(jti)) return false;
    this.used.add(jti);
    return true;
  }
}
