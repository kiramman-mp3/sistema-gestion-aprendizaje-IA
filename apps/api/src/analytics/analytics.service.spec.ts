import type { AuditService } from "../audit/audit.service";
import type { PrismaService } from "../database/prisma.service";
import type { IntegrationAccountService } from "../integrations/integration-account.service";
import { findLanguageViolations } from "../recommendations/pedagogical-language";
import { buildDataset, NOW } from "./analytics.fixtures";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import type { AnalyticsDataService } from "./analytics-data.service";
import type { AnalyticsDataset } from "./analytics.types";

const AUTH = { moodleUserId: 42, courseId: 7 };

function setup(dataset: AnalyticsDataset = buildDataset(), storedRules: object[] = []) {
  const data = { load: jest.fn(async () => dataset) };
  const prisma = { difficultyRule: { findMany: jest.fn(async () => storedRules) } };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new AnalyticsService(
    data as unknown as AnalyticsDataService,
    prisma as unknown as PrismaService,
    { currentId: async () => "cuenta-1" } as unknown as IntegrationAccountService,
    audit as unknown as AuditService,
  );
  return { service, prisma, audit };
}

describe("AnalyticsService.courseAnalytics", () => {
  it("devuelve indicadores y señales con la forma del contrato", async () => {
    const { service } = setup();

    const result = await service.courseAnalytics(AUTH, NOW);

    expect(result.courseId).toBe(7);
    expect(result.computedAt).toBe("2026-11-10T12:00:00.000Z");
    expect(result.indicators.find((i) => i.key === "delivery_rate")?.value).toBe(50);
    expect(result.signals).toEqual([
      expect.objectContaining({ studentId: 3, rule: "MISSING_REQUIRED" }),
    ]);
    for (const signal of result.signals) {
      expect(Object.keys(signal).sort()).toEqual(["explanation", "rule", "studentId"]);
    }
  });

  it("consulta las reglas del curso y las institucionales de la cuenta", async () => {
    const { service, prisma } = setup();

    await service.courseAnalytics(AUTH, NOW);

    expect(prisma.difficultyRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          integrationAccountId: "cuenta-1",
          OR: [{ moodleCourseId: null }, { moodleCourseId: 7 }],
        },
      }),
    );
  });

  it("una regla desactivada en la base no genera señales", async () => {
    const { service } = setup(buildDataset(), [
      { rule: "MISSING_REQUIRED", moodleCourseId: 7, enabled: false, params: {} },
    ]);

    expect((await service.courseAnalytics(AUTH, NOW)).signals).toEqual([]);
  });

  it("los parámetros guardados cambian el resultado", async () => {
    const { service } = setup(buildDataset(), [
      { rule: "MISSING_REQUIRED", moodleCourseId: null, enabled: true, params: { minMissing: 1 } },
    ]);

    const signals = (await service.courseAnalytics(AUTH, NOW)).signals;

    expect(signals.map((s) => s.studentId)).toEqual([2, 3, 4]);
  });

  it("con datos faltantes los indicadores quedan sin valor y no hay señales inventadas", async () => {
    const { service } = setup(
      buildDataset({
        submissions: null,
        grades: null,
        pending: null,
        completion: null,
        lastAccess: null,
      }),
    );

    const result = await service.courseAnalytics(AUTH, NOW);

    expect(result.indicators.every((i) => i.value === null)).toBe(true);
    expect(result.signals).toEqual([]);
  });

  it("audita solo la cantidad de señales", async () => {
    const { service, audit } = setup();

    await service.courseAnalytics(AUTH, NOW);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "analytics.course_view",
        metadata: { signals: 1 },
      }),
    );
  });
});

describe("AnalyticsService.studentEvidence", () => {
  it("separa lo observado, lo calculado y lo desconocido", async () => {
    const { service } = setup();

    const result = await service.studentEvidence(AUTH, 1, NOW);

    expect(result.courseId).toBe(7);
    expect(result.studentId).toBe(1);
    expect(result.observed).toEqual(
      expect.arrayContaining([
        { label: "Tareas entregadas (vencidas)", value: "2 de 2" },
        { label: "Nota · Tarea 10", value: "9 / 10" },
        { label: "Nota · Tarea 11", value: "8 / 10" },
        { label: "Entregas sin calificar", value: "Tarea 11" },
        { label: "Último acceso al curso", value: "2026-11-09" },
      ]),
    );
    expect(result.computed.find((i) => i.key === "average_grade_percent")?.value).toBe(85);
    expect(result.unknown).toEqual([]);
  });

  it("un estudiante sin entregas ni notas: lo observado lo dice y lo desconocido lo explica", async () => {
    const { service } = setup();

    const result = await service.studentEvidence(AUTH, 3, NOW);

    expect(result.observed).toEqual(
      expect.arrayContaining([
        { label: "Tareas entregadas (vencidas)", value: "0 de 2" },
        { label: "Tareas vencidas sin entrega", value: "Tarea 10, Tarea 11" },
      ]),
    );
    expect(result.unknown).toContain("El estudiante no tiene notas registradas.");
    expect(result.computed.find((i) => i.key === "average_grade_percent")?.value).toBeNull();
  });

  it("quien nunca entró aparece como hecho observado, no como una fecha inventada", async () => {
    const { service } = setup();

    const result = await service.studentEvidence(AUTH, 4, NOW);

    expect(result.observed).toContainEqual({
      label: "Último acceso al curso",
      value: "Nunca ha entrado",
    });
  });

  it("declara como desconocido lo que no se pudo leer de Moodle", async () => {
    const { service } = setup(
      buildDataset({
        submissions: null,
        grades: null,
        pending: null,
        completion: null,
        lastAccess: null,
        mappings: [],
      }),
    );

    const result = await service.studentEvidence(AUTH, 1, NOW);

    expect(result.unknown).toEqual(
      expect.arrayContaining([
        expect.stringContaining("entregas de Moodle"),
        expect.stringContaining("notas de Moodle"),
        expect.stringContaining("finalización"),
        expect.stringContaining("accesos"),
        expect.stringContaining("no están relacionadas con unidades"),
      ]),
    );
    expect(result.observed).toEqual([]);
  });

  it("avisa cuando el curso no tiene sílabo revisado ni tareas vencidas", async () => {
    const { service } = setup(buildDataset({ units: [], mappings: [], activities: [] }));

    const unknown = (await service.studentEvidence(AUTH, 1, NOW)).unknown;

    expect(unknown).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Ninguna tarea visible ha vencido"),
        expect.stringContaining("no tiene un sílabo revisado"),
      ]),
    );
  });

  it("responde 404 si el estudiante no está matriculado en el curso", async () => {
    const { service, audit } = setup();

    await expect(service.studentEvidence(AUTH, 999, NOW)).rejects.toMatchObject({
      response: { code: "STUDENT_NOT_FOUND" },
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("audita solo el id del estudiante, sin notas ni nombres", async () => {
    const { service, audit } = setup();

    await service.studentEvidence(AUTH, 1, NOW);

    expect(audit.record).toHaveBeenCalledWith({
      action: "analytics.student_view",
      outcome: "SUCCESS",
      actorMoodleId: 42,
      courseId: 7,
      resourceType: "student",
      resourceId: "1",
    });
  });

  it("lo que dice el sistema describe hechos, sin diagnósticos ni etiquetas", async () => {
    const { service } = setup();

    for (const id of [1, 2, 3, 4]) {
      const result = await service.studentEvidence(AUTH, id, NOW);
      const texts = [
        ...result.observed.flatMap((f) => [f.label, f.value]),
        ...result.unknown,
        ...result.computed.flatMap((i) => [i.label, i.definition]),
      ];
      for (const text of texts) expect(findLanguageViolations(text)).toEqual([]);
    }
  });
});

describe("AnalyticsController", () => {
  it.each(["abc", "0", "-3", "1.5", "99999999999", ""])(
    "responde 404 si el id del estudiante es «%s»",
    (id) => {
      const controller = new AnalyticsController({ studentEvidence: jest.fn() } as never);

      expect(() => controller.student(AUTH, id)).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: "STUDENT_NOT_FOUND" }),
        }),
      );
    },
  );
});
