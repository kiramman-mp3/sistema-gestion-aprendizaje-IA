import { Injectable } from "@nestjs/common";
import type { HealthIndicator } from "./health-indicator";

export type DependencyStatus = "ok" | "down";

/** Forma del contrato OpenAPI (`components/schemas/Health`). */
export interface HealthReport {
  status: "ok" | "degraded" | "down";
  dependencies: Record<string, DependencyStatus>;
}

const CHECK_TIMEOUT_MS = 3_000;

@Injectable()
export class HealthService {
  private readonly indicators = new Map<string, HealthIndicator>();

  register(indicator: HealthIndicator): void {
    this.indicators.set(indicator.name, indicator);
  }

  async check(): Promise<HealthReport> {
    const results = await Promise.all(
      [...this.indicators.values()].map(async (indicator) => {
        const healthy = await withTimeout(indicator.isHealthy(), CHECK_TIMEOUT_MS);
        return [indicator.name, healthy ? "ok" : "down"] as const;
      }),
    );

    const dependencies = Object.fromEntries(results) as Record<string, DependencyStatus>;
    const down = results.filter(([, s]) => s === "down").length;
    const status = down === 0 ? "ok" : down === results.length ? "down" : "degraded";

    return { status, dependencies };
  }
}

async function withTimeout(check: Promise<boolean>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([check.catch(() => false), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
