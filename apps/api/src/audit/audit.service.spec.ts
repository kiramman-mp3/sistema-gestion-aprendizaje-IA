import type { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import type { PrismaService } from "../database/prisma.service";
import { AuditService } from "./audit.service";

function setup(databaseUrl: string | undefined, create = jest.fn().mockResolvedValue({})) {
  const prisma = { auditEvent: { create } } as unknown as PrismaService;
  const config = { get: () => databaseUrl } as unknown as ConfigService<Env, true>;
  return { service: new AuditService(prisma, config), create };
}

describe("AuditService", () => {
  it("guarda el evento con sus campos", async () => {
    const { service, create } = setup("postgresql://db");

    await service.record({
      action: "access.denied",
      outcome: "DENIED",
      actorMoodleId: 6,
      courseId: 2,
      metadata: { code: "FORBIDDEN_COURSE", method: "GET" },
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        action: "access.denied",
        outcome: "DENIED",
        actorMoodleId: 6,
        moodleCourseId: 2,
        resourceType: null,
        resourceId: null,
        metadata: { code: "FORBIDDEN_COURSE", method: "GET" },
      },
    });
  });

  it("recorta valores largos de metadata", async () => {
    const { service, create } = setup("postgresql://db");

    await service.record({ action: "x", outcome: "ERROR", metadata: { path: "a".repeat(500) } });

    const metadata = (create.mock.calls[0]?.[0] as { data: { metadata: { path: string } } }).data
      .metadata;
    expect(metadata.path).toHaveLength(200);
  });

  it("no hace nada sin base de datos configurada", async () => {
    const { service, create } = setup(undefined);

    await service.record({ action: "x", outcome: "SUCCESS" });
    expect(create).not.toHaveBeenCalled();
  });

  it("no propaga errores de escritura", async () => {
    const { service } = setup(
      "postgresql://db",
      jest.fn().mockRejectedValue(new Error("db caída")),
    );
    jest.spyOn(service["logger"], "error").mockImplementation(() => undefined);

    await expect(service.record({ action: "x", outcome: "SUCCESS" })).resolves.toBeUndefined();
  });
});
