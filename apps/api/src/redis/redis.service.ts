import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import type { HealthIndicator } from "../health/health-indicator";

/**
 * Conexión compartida a Redis. En el Sprint 3 guarda los `jti` usados (ADR-006) y en el Sprint 4 la
 * reutiliza la cola de trabajos (ADR-004).
 */
@Injectable()
export class RedisService implements HealthIndicator, OnModuleDestroy {
  readonly name = "redis";

  constructor(readonly client: Redis) {}

  static fromUrl(url: string): RedisService {
    return new RedisService(
      new Redis(url, {
        lazyConnect: true,
        // Falla rápido en lugar de encolar comandos indefinidamente si Redis no está.
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      }),
    );
  }

  async isHealthy(): Promise<boolean> {
    if (this.client.status === "wait") await this.client.connect();
    return (await this.client.ping()) === "PONG";
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== "end" && this.client.status !== "wait") {
      await this.client.quit();
    }
  }
}
