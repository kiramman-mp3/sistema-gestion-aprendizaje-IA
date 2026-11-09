import { Injectable, Logger } from "@nestjs/common";
import type { HealthIndicator } from "../health/health-indicator";
import type { ClamavClient } from "./clamav.client";

export type ScanVerdict =
  | { status: "clean" }
  | { status: "infected"; signature: string }
  /** Sin antivirus configurado; solo se permite fuera de producción (ver `env.ts`). */
  | { status: "skipped" };

/** Análisis antivirus de los archivos subidos (RF-03). Lanza `AntivirusUnavailableError` si clamd falla. */
@Injectable()
export class AntivirusService implements HealthIndicator {
  readonly name = "antivirus";
  private readonly logger = new Logger(AntivirusService.name);

  constructor(private readonly client: ClamavClient | null) {
    if (!client) {
      this.logger.warn("CLAMAV_URL no está definida; los archivos subidos no se analizan.");
    }
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async scan(content: Buffer): Promise<ScanVerdict> {
    if (!this.client) return { status: "skipped" };
    const result = await this.client.scan(content);
    return result.clean ? { status: "clean" } : { status: "infected", signature: result.signature };
  }

  async isHealthy(): Promise<boolean> {
    return this.client ? this.client.ping() : false;
  }
}
