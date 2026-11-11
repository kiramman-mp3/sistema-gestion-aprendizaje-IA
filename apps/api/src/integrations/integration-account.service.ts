import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { PrismaService } from "../database/prisma.service";

/**
 * Cuenta de integración del sitio Moodle configurado. Hoy hay un solo sitio por despliegue; la cuenta
 * se crea la primera vez que se necesita y guarda solo referencias a los secretos, nunca sus valores.
 */
@Injectable()
export class IntegrationAccountService {
  private cached?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Id de la cuenta del sitio actual. */
  currentId(): Promise<string> {
    this.cached ??= this.resolve().catch((error: unknown) => {
      // Si falla (por ejemplo, la base no responde), el siguiente intento vuelve a consultar.
      this.cached = undefined;
      throw error;
    });
    return this.cached;
  }

  private async resolve(): Promise<string> {
    const moodleBaseUrl = this.config.get("MOODLE_BASE_URL", { infer: true });
    if (!moodleBaseUrl) {
      throw new ServiceUnavailableException({
        code: "AUTH_NOT_CONFIGURED",
        message: "El backend no tiene configurada la URL de Moodle.",
      });
    }
    const account = await this.prisma.integrationAccount.upsert({
      where: { moodleBaseUrl },
      update: {},
      create: {
        name: new URL(moodleBaseUrl).host,
        moodleBaseUrl,
        tokenSecretRef: "env:MOODLE_TOKEN",
        jwtKeyRef: "env:PLUGIN_JWT_SECRET",
      },
      select: { id: true },
    });
    return account.id;
  }
}
