import type { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import type { PrismaService } from "../database/prisma.service";
import { UsageLimitExceededError, UsageQuotaService } from "./usage-quota.service";

const NOW = new Date("2026-11-10T12:00:00Z");
const HOUR = 60 * 60 * 1000;

function setup(options: { messages: number; tokensIn: number; tokensOut: number; oldest?: Date }) {
  const prisma = {
    aiMessage: {
      aggregate: jest.fn(async () => ({
        _sum: { tokensIn: options.tokensIn, tokensOut: options.tokensOut },
      })),
      count: jest.fn(async () => options.messages),
      findFirst: jest.fn(async () => (options.oldest ? { createdAt: options.oldest } : null)),
    },
  };
  const config = {
    get: (key: string) =>
      ({ AI_DAILY_MESSAGES_PER_TEACHER: 10, AI_DAILY_TOKENS_PER_TEACHER: 1_000 })[key],
  } as unknown as ConfigService<Env, true>;
  return { service: new UsageQuotaService(prisma as unknown as PrismaService, config), prisma };
}

describe("UsageQuotaService", () => {
  it("deja pasar a un docente dentro de sus límites", async () => {
    const { service } = setup({ messages: 9, tokensIn: 400, tokensOut: 500 });

    await expect(service.assertWithinLimits(42, NOW)).resolves.toBeUndefined();
  });

  it("cuenta solo las últimas 24 horas y solo al docente indicado", async () => {
    const { service, prisma } = setup({ messages: 0, tokensIn: 0, tokensOut: 0 });

    await service.assertWithinLimits(42, NOW);

    expect(prisma.aiMessage.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversation: { moodleUserId: 42 },
          createdAt: { gte: new Date(NOW.getTime() - 24 * HOUR) },
        },
      }),
    );
  });

  it("bloquea al llegar al tope de mensajes y avisa cuándo se libera", async () => {
    const { service } = setup({
      messages: 10,
      tokensIn: 0,
      tokensOut: 0,
      oldest: new Date(NOW.getTime() - 20 * HOUR),
    });

    const error = await service.assertWithinLimits(42, NOW).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UsageLimitExceededError);
    expect((error as UsageLimitExceededError).retryAfterSeconds).toBe(4 * 3600);
    expect((error as UsageLimitExceededError).getStatus()).toBe(429);
    expect((error as UsageLimitExceededError).getResponse()).toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("bloquea al llegar al tope de tokens, sumando entrada y salida", async () => {
    const { service } = setup({ messages: 1, tokensIn: 600, tokensOut: 400 });

    await expect(service.assertWithinLimits(42, NOW)).rejects.toBeInstanceOf(
      UsageLimitExceededError,
    );
  });

  it("pide esperar al menos un minuto", async () => {
    const { service } = setup({
      messages: 10,
      tokensIn: 0,
      tokensOut: 0,
      oldest: new Date(NOW.getTime() - 24 * HOUR + 1_000),
    });

    const error = (await service
      .assertWithinLimits(42, NOW)
      .catch((e: unknown) => e)) as UsageLimitExceededError;

    expect(error.retryAfterSeconds).toBe(60);
  });
});
