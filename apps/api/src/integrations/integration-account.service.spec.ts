import { ServiceUnavailableException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import type { PrismaService } from "../database/prisma.service";
import { IntegrationAccountService } from "./integration-account.service";

function build(moodleBaseUrl: string | undefined, upsert: jest.Mock): IntegrationAccountService {
  const prisma = { integrationAccount: { upsert } } as unknown as PrismaService;
  const config = { get: () => moodleBaseUrl } as unknown as ConfigService<Env, true>;
  return new IntegrationAccountService(prisma, config);
}

describe("IntegrationAccountService", () => {
  it("crea la cuenta una vez con referencias a los secretos, no sus valores", async () => {
    const upsert = jest.fn().mockResolvedValue({ id: "cuenta-1" });
    const service = build("http://localhost:8000", upsert);

    await expect(service.currentId()).resolves.toBe("cuenta-1");
    await expect(service.currentId()).resolves.toBe("cuenta-1");
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0]).toMatchObject({
      where: { moodleBaseUrl: "http://localhost:8000" },
      create: {
        name: "localhost:8000",
        tokenSecretRef: "env:MOODLE_TOKEN",
        jwtKeyRef: "env:PLUGIN_JWT_SECRET",
      },
    });
  });

  it("reintenta en la siguiente llamada si la base falló", async () => {
    const upsert = jest
      .fn()
      .mockRejectedValueOnce(new Error("sin base"))
      .mockResolvedValueOnce({ id: "cuenta-1" });
    const service = build("http://localhost:8000", upsert);

    await expect(service.currentId()).rejects.toThrow("sin base");
    await expect(service.currentId()).resolves.toBe("cuenta-1");
  });

  it("responde 503 si falta la URL de Moodle", async () => {
    await expect(build(undefined, jest.fn()).currentId()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
