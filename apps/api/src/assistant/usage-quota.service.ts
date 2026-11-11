import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { PrismaService } from "../database/prisma.service";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 429 `RATE_LIMITED` por uso de IA (RNF-07); el filtro de errores traduce `retryAfterSeconds` a `Retry-After`. */
export class UsageLimitExceededError extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      {
        code: "RATE_LIMITED",
        message: "Alcanzaste el límite diario de uso del asistente. Inténtalo más tarde.",
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Límite de uso y costo de IA por docente (RNF-07). Se calcula sobre lo ya guardado en
 * `ai_messages` en las últimas 24 horas: mensajes enviados y tokens consumidos. Así sobrevive a un
 * reinicio y no depende de Redis.
 */
@Injectable()
export class UsageQuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Lanza `UsageLimitExceededError` si el docente ya agotó su cuota diaria. */
  async assertWithinLimits(moodleUserId: number, now = new Date()): Promise<void> {
    const since = new Date(now.getTime() - DAY_MS);
    const where = { conversation: { moodleUserId }, createdAt: { gte: since } };

    const [tokens, messages] = await Promise.all([
      this.prisma.aiMessage.aggregate({ where, _sum: { tokensIn: true, tokensOut: true } }),
      this.prisma.aiMessage.count({ where: { ...where, role: "USER" } }),
    ]);
    const usedTokens = (tokens._sum.tokensIn ?? 0) + (tokens._sum.tokensOut ?? 0);

    const overMessages =
      messages >= this.config.get("AI_DAILY_MESSAGES_PER_TEACHER", { infer: true });
    const overTokens =
      usedTokens >= this.config.get("AI_DAILY_TOKENS_PER_TEACHER", { infer: true });
    if (!overMessages && !overTokens) return;

    // La ventana se libera cuando sale el mensaje más antiguo.
    const oldest = await this.prisma.aiMessage.findFirst({
      where,
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    const releaseAt = (oldest?.createdAt.getTime() ?? now.getTime()) + DAY_MS;
    throw new UsageLimitExceededError(Math.max(60, (releaseAt - now.getTime()) / 1000));
  }
}
