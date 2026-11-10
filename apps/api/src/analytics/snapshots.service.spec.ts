import type { ConfigService } from "@nestjs/config";
import type { AuthContext } from "../auth/auth-context";
import type { Env } from "../config/env";
import type { PrismaService } from "../database/prisma.service";
import type { IntegrationAccountService } from "../integrations/integration-account.service";
import type { Indicator } from "./analytics.types";
import { SnapshotsService, SNAPSHOT_FORMULA_VERSION } from "./snapshots.service";

const AUTH: AuthContext = { moodleUserId: 42, courseId: 7 };
const NOW = new Date("2026-11-10T15:30:00Z");

const indicator = (key: string, value: number | null): Indicator => ({
  key,
  label: key,
  value,
  unit: "%",
  definition: "d",
});

function setup(options: { existing?: boolean; createError?: unknown; rows?: object[] } = {}) {
  const prisma = {
    analyticsSnapshot: {
      findFirst: jest.fn(async () => (options.existing ? { id: "s1" } : null)),
      create: jest.fn(async () => {
        if (options.createError) throw options.createError;
        return {};
      }),
      findMany: jest.fn(async () => options.rows ?? []),
      deleteMany: jest.fn(async () => ({ count: 3 })),
    },
  };
  const service = new SnapshotsService(
    prisma as unknown as PrismaService,
    { currentId: async () => "cuenta-1" } as unknown as IntegrationAccountService,
    { get: () => 365 } as unknown as ConfigService<Env, true>,
  );
  return { service, prisma };
}

describe("SnapshotsService.recordOncePerDay", () => {
  it("guarda el snapshot del día con el curso, el docente y solo valores numéricos", async () => {
    const { service, prisma } = setup();

    const saved = await service.recordOncePerDay(
      AUTH,
      [indicator("delivery_rate", 80), indicator("average_grade", null)],
      3,
      NOW,
    );

    expect(saved).toBe(true);
    expect(prisma.analyticsSnapshot.create).toHaveBeenCalledWith({
      data: {
        integrationAccountId: "cuenta-1",
        moodleCourseId: 7,
        takenBy: 42,
        takenOn: new Date("2026-11-10T00:00:00Z"),
        takenAt: NOW,
        indicators: {
          formula: SNAPSHOT_FORMULA_VERSION,
          signals: 3,
          values: { delivery_rate: 80, average_grade: null },
        },
      },
    });
  });

  it("no guarda el contenido de las señales ni ids de estudiantes", async () => {
    const { service, prisma } = setup();

    await service.recordOncePerDay(AUTH, [indicator("delivery_rate", 80)], 5, NOW);

    const stored = JSON.stringify(prisma.analyticsSnapshot.create.mock.calls[0]);
    expect(stored).not.toMatch(/studentId|explanation|label/);
  });

  it("no guarda un segundo snapshot el mismo día del mismo docente", async () => {
    const { service, prisma } = setup({ existing: true });

    expect(await service.recordOncePerDay(AUTH, [indicator("a", 1)], 0, NOW)).toBe(false);
    expect(prisma.analyticsSnapshot.create).not.toHaveBeenCalled();
  });

  it("el día es el UTC, aunque la hora local sea de otro día", async () => {
    const { service, prisma } = setup();

    await service.recordOncePerDay(AUTH, [indicator("a", 1)], 0, new Date("2026-11-10T23:59:59Z"));

    expect(prisma.analyticsSnapshot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ takenOn: new Date("2026-11-10T00:00:00Z") }),
      }),
    );
  });

  it("un curso sin ningún dato no deja snapshot", async () => {
    const { service, prisma } = setup();

    expect(await service.recordOncePerDay(AUTH, [indicator("a", null)], 0, NOW)).toBe(false);
    expect(prisma.analyticsSnapshot.findFirst).not.toHaveBeenCalled();
  });

  it("si dos aperturas llegan juntas y chocan con el índice único, no falla", async () => {
    const { service } = setup({ createError: Object.assign(new Error("dup"), { code: "P2002" }) });

    await expect(service.recordOncePerDay(AUTH, [indicator("a", 1)], 0, NOW)).resolves.toBe(false);
  });

  it("si la base falla, el panel no se interrumpe", async () => {
    const { service } = setup({ createError: new Error("base caída") });

    await expect(service.recordOncePerDay(AUTH, [indicator("a", 1)], 0, NOW)).resolves.toBe(false);
  });
});

describe("SnapshotsService.history", () => {
  const row = (takenAt: string, values: object, formula = SNAPSHOT_FORMULA_VERSION) => ({
    takenAt: new Date(takenAt),
    indicators: { formula, signals: 2, values },
  });

  it("devuelve solo los snapshots del propio docente, con la forma del contrato", async () => {
    const { service, prisma } = setup({
      rows: [
        row("2026-11-08T10:00:00Z", { delivery_rate: 70, average_grade: null }),
        row("2026-11-09T10:00:00Z", { delivery_rate: 75, average_grade: 6.5 }),
      ],
    });

    const result = await service.history(AUTH, {}, NOW);

    expect(prisma.analyticsSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          integrationAccountId: "cuenta-1",
          moodleCourseId: 7,
          takenBy: 42,
        }),
        orderBy: { takenAt: "asc" },
      }),
    );
    expect(result).toEqual({
      courseId: 7,
      snapshots: [
        {
          takenAt: "2026-11-08T10:00:00.000Z",
          signals: 2,
          indicators: [
            { key: "delivery_rate", value: 70 },
            { key: "average_grade", value: null },
          ],
        },
        {
          takenAt: "2026-11-09T10:00:00.000Z",
          signals: 2,
          indicators: [
            { key: "delivery_rate", value: 75 },
            { key: "average_grade", value: 6.5 },
          ],
        },
      ],
    });
  });

  it("por defecto mira 90 días atrás y acepta de 1 a 365", async () => {
    const { service, prisma } = setup();

    await service.history(AUTH, {}, NOW);
    await service.history(AUTH, { days: "30" }, NOW);

    const since = (n: number) =>
      (
        prisma.analyticsSnapshot.findMany.mock.calls[n] as unknown as [
          { where: { takenAt: { gte: Date } } },
        ]
      )[0].where.takenAt.gte;
    expect(since(0)).toEqual(new Date("2026-08-12T15:30:00Z"));
    expect(since(1)).toEqual(new Date("2026-10-11T15:30:00Z"));
  });

  it.each(["0", "366", "abc", "1.5"])("rechaza days=%s con 400", async (days) => {
    const { service } = setup();

    await expect(service.history(AUTH, { days })).rejects.toMatchObject({
      response: { code: "VALIDATION_ERROR" },
    });
  });

  it("ignora un snapshot guardado con otra versión de la fórmula", async () => {
    const { service } = setup({ rows: [row("2026-11-08T10:00:00Z", { a: 1 }, 99)] });

    expect((await service.history(AUTH, {}, NOW)).snapshots).toEqual([]);
  });
});

describe("SnapshotsService.purgeExpired", () => {
  it("borra los snapshots más viejos que la retención", async () => {
    const { service, prisma } = setup();

    expect(await service.purgeExpired(NOW)).toBe(3);
    expect(prisma.analyticsSnapshot.deleteMany).toHaveBeenCalledWith({
      where: { takenAt: { lt: new Date("2025-11-10T15:30:00Z") } },
    });
  });
});
