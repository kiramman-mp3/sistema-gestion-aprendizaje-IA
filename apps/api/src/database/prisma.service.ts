import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import type { HealthIndicator } from "../health/health-indicator";

/** Cliente único de Prisma para el proceso (cada instancia abre su propio pool de conexiones). */
@Injectable()
export class PrismaService extends PrismaClient implements HealthIndicator, OnModuleDestroy {
  readonly name = "database";

  constructor(connectionString: string) {
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async isHealthy(): Promise<boolean> {
    await this.$queryRaw`SELECT 1`;
    return true;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
