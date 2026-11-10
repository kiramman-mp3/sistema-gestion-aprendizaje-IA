import { Logger, Module, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env";
import { HealthService } from "../../health/health.service";
import { MoodleClient } from "./moodle.client";
import { MoodleService } from "./moodle.service";

@Module({
  providers: [
    {
      provide: MoodleClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new MoodleClient({
          baseUrl: config.get("MOODLE_BASE_URL", { infer: true }) ?? "http://localhost:8000",
          token: config.get("MOODLE_TOKEN", { infer: true }) ?? "",
          timeoutMs: config.get("MOODLE_TIMEOUT_MS", { infer: true }),
        }),
    },
    MoodleService,
  ],
  exports: [MoodleService],
})
export class MoodleModule implements OnModuleInit {
  private readonly logger = new Logger(MoodleModule.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly health: HealthService,
    private readonly moodle: MoodleService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get("MOODLE_BASE_URL", { infer: true })) {
      this.logger.warn(
        "MOODLE_BASE_URL no está definida; la integración con Moodle está inactiva.",
      );
      return;
    }
    this.health.register(this.moodle);
  }
}
