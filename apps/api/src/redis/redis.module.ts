import { Global, Logger, Module, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { HealthService } from "../health/health.service";
import { RedisService } from "./redis.service";

@Global()
@Module({
  providers: [
    {
      provide: RedisService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        RedisService.fromUrl(config.get("REDIS_URL", { infer: true }) ?? "redis://localhost:6379"),
    },
  ],
  exports: [RedisService],
})
export class RedisModule implements OnModuleInit {
  private readonly logger = new Logger(RedisModule.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly health: HealthService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get("REDIS_URL", { infer: true })) {
      this.logger.warn("REDIS_URL no está definida; Redis está inactivo.");
      return;
    }
    this.health.register(this.redis);
  }
}
