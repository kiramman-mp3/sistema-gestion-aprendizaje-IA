import type { MoodleRead } from "../integrations/moodle/moodle-read.service";
import type { MappingsService } from "../mappings/mappings.service";
import { buildDataset, NOW } from "./analytics.fixtures";
import { AnalyticsDataService, MAX_SUBMISSION_READS } from "./analytics-data.service";

const AUTH = { moodleUserId: 42, courseId: 7 };

/** Moodle simulado a partir del curso de ejemplo; cada prueba rompe lo que necesita. */
function setup(overrides: Partial<Record<keyof MoodleRead, unknown>> = {}) {
  const base = buildDataset();
  const moodle = {
    listActivities: jest.fn(async () => ({ truncated: false, activities: base.activities })),
    listStudents: jest.fn(async () => ({
      truncated: false,
      students: base.studentIds.map((studentid) => ({ studentid })),
    })),
    getSubmissions: jest.fn(async (_u: number, _c: number, cmid: number) => ({
      cmid,
      truncated: false,
      submissions: base.submissions!.get(cmid) ?? [],
    })),
    getPendingGrading: jest.fn(async () => ({ truncated: false, pending: base.pending! })),
    getGrades: jest.fn(async () => ({ truncated: false, grades: base.grades! })),
    getCompletion: jest.fn(async () => ({ truncated: false, completion: base.completion! })),
    getLastAccess: jest.fn(async () => ({ truncated: false, lastaccess: base.lastAccess! })),
    ...overrides,
  };
  const mappings = {
    overview: jest.fn(async () => ({
      syllabusId: "s1",
      extractionVersion: 1,
      units: base.units.map((u) => ({ ...u, periodName: "Parcial 1", learningOutcomeIds: [] })),
      outcomes: [],
      mappings: base.mappings.map((m) => ({
        moodleCmId: m.cmid,
        unitRef: m.unitRef,
        learningOutcomeIds: m.learningOutcomeIds,
        source: "PROPOSAL" as const,
      })),
    })),
  };
  const service = new AnalyticsDataService(
    moodle as unknown as MoodleRead,
    mappings as unknown as MappingsService,
  );
  return { service, moodle };
}

describe("AnalyticsDataService", () => {
  it("reúne los datos del curso con el docente y el curso del token", async () => {
    const { service, moodle } = setup();

    const data = await service.load(AUTH, NOW);

    expect(moodle.listActivities).toHaveBeenCalledWith(42, 7);
    expect(data.studentIds).toEqual([1, 2, 3, 4]);
    expect(data.pending).toHaveLength(2);
    expect(data.grades).toHaveLength(5);
    expect(data.mappings).toEqual(buildDataset().mappings);
    expect(data.units.map((u) => u.title)).toEqual(["Unidad 1", "Unidad 2"]);
  });

  it("lee las entregas solo de las tareas visibles y vencidas", async () => {
    const { service, moodle } = setup();

    const data = await service.load(AUTH, NOW);

    expect(
      (moodle.getSubmissions as jest.Mock).mock.calls.map((call: unknown[]) => call[2]).sort(),
    ).toEqual([10, 11]);
    expect([...data.submissions!.keys()].sort()).toEqual([10, 11]);
  });

  it.each(["listActivities", "listStudents"] as const)(
    "responde 503 MOODLE_UNAVAILABLE si falla la lectura esencial %s",
    async (method) => {
      const { service } = setup({ [method]: async () => Promise.reject(new Error("caído")) });

      await expect(service.load(AUTH, NOW)).rejects.toMatchObject({
        response: { code: "MOODLE_UNAVAILABLE" },
      });
    },
  );

  it.each([
    ["getGrades", "grades"],
    ["getPendingGrading", "pending"],
    ["getCompletion", "completion"],
    ["getLastAccess", "lastAccess"],
  ] as const)("si falla %s solo ese dato queda en null", async (method, field) => {
    const { service } = setup({ [method]: async () => Promise.reject(new Error("sin función")) });

    const data = await service.load(AUTH, NOW);

    expect(data[field]).toBeNull();
    expect(data.studentIds).toHaveLength(4);
    expect(data.submissions).not.toBeNull();
  });

  it("una lista recortada por Moodle se descarta: un conteo parcial engañaría", async () => {
    const { service } = setup({
      getGrades: async () => ({ truncated: true, grades: [] }),
    });

    expect((await service.load(AUTH, NOW)).grades).toBeNull();
  });

  it("con los estudiantes recortados no se calcula nada del curso", async () => {
    const { service } = setup({
      listStudents: async () => ({ truncated: true, students: [{ studentid: 1 }] }),
    });

    const data = await service.load(AUTH, NOW);

    expect(data.studentIds).toEqual([]);
    expect(data.grades).toBeNull();
    expect(data.submissions).toBeNull();
  });

  it("si falla la lectura de una sola tarea, descarta todas las entregas", async () => {
    const { service } = setup({
      getSubmissions: async (_u: number, _c: number, cmid: number) =>
        cmid === 11
          ? Promise.reject(new Error("falla"))
          : { cmid, truncated: false, submissions: [] },
    });

    expect((await service.load(AUTH, NOW)).submissions).toBeNull();
  });

  it("si una lista de entregas viene recortada, descarta todas las entregas", async () => {
    const { service } = setup({
      getSubmissions: async (_u: number, _c: number, cmid: number) => ({
        cmid,
        truncated: cmid === 10,
        submissions: [],
      }),
    });

    expect((await service.load(AUTH, NOW)).submissions).toBeNull();
  });

  it(`con más de ${MAX_SUBMISSION_READS} tareas vencidas no lee las entregas`, async () => {
    const many = Array.from({ length: MAX_SUBMISSION_READS + 1 }, (_, i) => ({
      ...buildDataset().activities[0]!,
      cmid: 100 + i,
    }));
    const { service, moodle } = setup({
      listActivities: async () => ({ truncated: false, activities: many }),
    });

    const data = await service.load(AUTH, NOW);

    expect(data.submissions).toBeNull();
    expect(moodle.getSubmissions).not.toHaveBeenCalled();
  });
});
