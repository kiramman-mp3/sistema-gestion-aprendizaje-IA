import { Module, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { HealthService } from "../health/health.service";
import { AntivirusService } from "./antivirus.service";
import { ClamavClient } from "./clamav.client";

@Module({
  providers: [
    {
      provide: AntivirusService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const url = config.get("CLAMAV_URL", { infer: true });
        const timeoutMs = config.get("CLAMAV_TIMEOUT_MS", { infer: true });
        return new AntivirusService(url ? ClamavClient.fromUrl(url, timeoutMs) : null);
      },
    },
  ],
  exports: [AntivirusService],
})
export class AntivirusModule implements OnModuleInit {
  constructor(
    private readonly health: HealthService,
    private readonly antivirus: AntivirusService,
  ) {}

  onModuleInit(): void {
    if (this.antivirus.enabled) this.health.register(this.antivirus);
  }
}
