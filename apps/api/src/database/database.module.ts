import { Global, Logger, Module, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { HealthService } from "../health/health.service";
import { PrismaService } from "./prisma.service";

@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new PrismaService(config.get("DATABASE_URL", { infer: true }) ?? ""),
    },
  ],
  exports: [PrismaService],
})
export class DatabaseModule implements OnModuleInit {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly health: HealthService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get("DATABASE_URL", { infer: true })) {
      this.logger.warn("DATABASE_URL no está definida; la base auxiliar está inactiva.");
      return;
    }
    this.health.register(this.prisma);
  }
}
