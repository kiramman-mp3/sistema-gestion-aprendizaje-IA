import { buildDataset } from "../../analytics/analytics.fixtures";
import type { AnalyticsDataService } from "../../analytics/analytics-data.service";
import { MoodleRead } from "../../integrations/moodle/moodle-read.service";
import { Pseudonymizer } from "../../privacy/pseudonymizer";
import type { ToolContext } from "./assistant-tool";
import {
  GetAssignmentSubmissionsTool,
  GetCourseActivitiesTool,
  GetGradeSummaryTool,
  GetPendingGradingTool,
  GetUnitPerformanceTool,
} from "./moodle-tools";

const SECRET = "una-clave-de-prueba-de-al-menos-32-caracteres";

function context(): ToolContext {
  return {
    auth: { moodleUserId: 42, courseId: 7 },
    pseudonymizer: new Pseudonymizer(SECRET, 7),
  };
}

/** Moodle simulado: solo responde lo que cada prueba programa. */
function moodle(overrides: Partial<Record<keyof MoodleRead, unknown>>): MoodleRead {
  const fail = (name: string) => () => Promise.reject(new Error(`${name} no programada`));
  return {
    listActivities: fail("listActivities"),
    listStudents: fail("listStudents"),
    getSubmissions: fail("getSubmissions"),
    getPendingGrading: fail("getPendingGrading"),
    getGrades: fail("getGrades"),
    getCompletion: fail("getCompletion"),
    getLastAccess: fail("getLastAccess"),
    ...overrides,
  } as unknown as MoodleRead;
}

const ALIAS = /^Estudiante#\d{8}$/;

describe("GetCourseActivitiesTool", () => {
  it("lista las actividades del curso del token, sin pedir el curso al modelo", async () => {
    const listActivities = jest.fn().mockResolvedValue({
      truncated: false,
      activities: [
        {
          cmid: 15,
          modname: "assign",
          name: "Tarea 3",
          sectionnum: 2,
          visible: true,
          duedate: "2026-12-04T23:59:00Z",
          maxgrade: 10,
        },
      ],
    });
    const tool = new GetCourseActivitiesTool(moodle({ listActivities }));

    const output = await tool.execute(context());

    expect(listActivities).toHaveBeenCalledWith(42, 7);
    expect(tool.input.safeParse({ courseId: 99 }).success).toBe(true);
    expect(output.data).toMatchObject({
      count: 1,
      activities: [{ cmid: 15, type: "assign", name: "Tarea 3", dueDate: "2026-12-04T23:59:00Z" }],
    });
    expect(output.intent).toBe("course_activities");
    expect(output.incomplete).toBe(false);
  });

  it("marca incompleto si Moodle recortó la lista", async () => {
    const tool = new GetCourseActivitiesTool(
      moodle({ listActivities: async () => ({ truncated: true, activities: [] }) }),
    );

    expect((await tool.execute(context())).incomplete).toBe(true);
  });
});

describe("GetAssignmentSubmissionsTool", () => {
  const rows = [
    { studentid: 1, status: "submitted", submittedat: "2026-12-03T10:00:00Z", late: false },
    { studentid: 2, status: "graded", submittedat: "2026-12-05T10:00:00Z", late: true },
    { studentid: 3, status: "missing", submittedat: null, late: false },
    { studentid: 4, status: "new", submittedat: null, late: false },
    { studentid: 5, status: "draft", submittedat: null, late: false },
  ];

  it("cuenta por estado y nombra solo con seudónimos a quienes faltan o entregaron tarde", async () => {
    const ctx = context();
    const getSubmissions = jest
      .fn()
      .mockResolvedValue({ cmid: 15, truncated: false, submissions: rows });
    const tool = new GetAssignmentSubmissionsTool(moodle({ getSubmissions }));

    const output = await tool.execute(ctx, { cmid: 15 });

    expect(getSubmissions).toHaveBeenCalledWith(42, 7, 15);
    expect(output.data).toMatchObject({
      cmid: 15,
      total: 5,
      delivered: 2,
      notDelivered: 2,
      drafts: 1,
      late: 1,
    });
    const data = output.data as { missingStudents: string[]; lateStudents: string[] };
    expect(data.missingStudents).toHaveLength(2);
    expect(data.missingStudents.every((alias) => ALIAS.test(alias))).toBe(true);
    expect(data.lateStudents).toEqual([ctx.pseudonymizer.alias(2)]);
    expect(output.sources).toEqual([{ type: "moodle_activity", id: 15 }]);
  });

  it("nunca incluye ids de estudiantes en lo que ve el modelo", async () => {
    const tool = new GetAssignmentSubmissionsTool(
      moodle({ getSubmissions: async () => ({ cmid: 15, truncated: false, submissions: rows }) }),
    );

    const output = await tool.execute(context(), { cmid: 15 });

    expect(JSON.stringify(output.data)).not.toMatch(/"studentid"/);
  });

  it("exige un cmid válido", () => {
    const tool = new GetAssignmentSubmissionsTool(moodle({}));

    expect(tool.input.safeParse({}).success).toBe(false);
    expect(tool.input.safeParse({ cmid: -1 }).success).toBe(false);
    expect(tool.input.safeParse({ cmid: "15" }).success).toBe(false);
  });

  it("propaga el fallo de Moodle para que el orquestador lo marque como dato incompleto", async () => {
    const tool = new GetAssignmentSubmissionsTool(moodle({}));

    await expect(tool.execute(context(), { cmid: 15 })).rejects.toThrow("no programada");
  });
});

describe("GetPendingGradingTool", () => {
  it("agrupa por actividad y cuenta estudiantes distintos", async () => {
    const getPendingGrading = jest.fn().mockResolvedValue({
      truncated: false,
      pending: [
        { cmid: 16, studentid: 3, submittedat: null },
        { cmid: 15, studentid: 1, submittedat: null },
        { cmid: 15, studentid: 2, submittedat: null },
        { cmid: 15, studentid: 2, submittedat: null },
      ],
    });
    const tool = new GetPendingGradingTool(moodle({ getPendingGrading }));

    const output = await tool.execute(context(), {});

    expect(getPendingGrading).toHaveBeenCalledWith(42, 7, undefined);
    const data = output.data as {
      totalPending: number;
      activities: { cmid: number; pending: number }[];
    };
    expect(data.totalPending).toBe(4);
    expect(data.activities.map((a) => [a.cmid, a.pending])).toEqual([
      [15, 2],
      [16, 1],
    ]);
    expect(output.sources).toEqual([
      { type: "moodle_activity", id: 15 },
      { type: "moodle_activity", id: 16 },
    ]);
  });

  it("filtra por actividad cuando se pide y enlaza al calificador si no hay pendientes", async () => {
    const getPendingGrading = jest.fn().mockResolvedValue({ truncated: false, pending: [] });
    const tool = new GetPendingGradingTool(moodle({ getPendingGrading }));

    const output = await tool.execute(context(), { cmid: 15 });

    expect(getPendingGrading).toHaveBeenCalledWith(42, 7, 15);
    expect(output.data).toEqual({ totalPending: 0, activities: [] });
    expect(output.sources).toEqual([{ type: "moodle_gradebook", id: 7 }]);
  });
});

describe("GetGradeSummaryTool", () => {
  const grades = [
    { cmid: 15, studentid: 1, grade: 9, grademax: 10, gradedat: null },
    { cmid: 15, studentid: 2, grade: 5, grademax: 10, gradedat: null },
    { cmid: 15, studentid: 3, grade: 0, grademax: 10, gradedat: null },
    { cmid: 15, studentid: 4, grade: null, grademax: 10, gradedat: null },
  ];

  it("no cuenta la nota ausente como cero y la informa aparte", async () => {
    const tool = new GetGradeSummaryTool(
      moodle({ getGrades: async () => ({ truncated: false, grades }) }),
    );

    const output = await tool.execute(context(), {});

    expect(output.data).toEqual({
      activities: [
        { cmid: 15, maxGrade: 10, graded: 3, withoutGrade: 1, average: 4.67, min: 0, max: 9 },
      ],
    });
  });

  it("lista con seudónimos a quienes están por debajo del porcentaje pedido", async () => {
    const ctx = context();
    const tool = new GetGradeSummaryTool(
      moodle({ getGrades: async () => ({ truncated: false, grades }) }),
    );

    const output = await tool.execute(ctx, { cmid: 15, belowPercent: 60 });

    const activity = (output.data as { activities: { belowThreshold: string[] }[] }).activities[0]!;
    expect(activity.belowThreshold).toEqual([
      ctx.pseudonymizer.alias(2),
      ctx.pseudonymizer.alias(3),
    ]);
  });

  it("no inventa promedio ni rango si nadie tiene nota", async () => {
    const tool = new GetGradeSummaryTool(
      moodle({
        getGrades: async () => ({
          truncated: false,
          grades: [{ cmid: 15, studentid: 1, grade: null, grademax: 10, gradedat: null }],
        }),
      }),
    );

    const output = await tool.execute(context(), {});

    expect(output.data).toMatchObject({
      activities: [{ graded: 0, withoutGrade: 1, average: null, min: null, max: null }],
    });
  });

  it("valida el porcentaje y marca incompleto si Moodle recortó", async () => {
    const tool = new GetGradeSummaryTool(
      moodle({ getGrades: async () => ({ truncated: true, grades: [] }) }),
    );

    expect(tool.input.safeParse({ belowPercent: 120 }).success).toBe(false);
    expect((await tool.execute(context(), {})).incomplete).toBe(true);
  });
});

describe("GetUnitPerformanceTool", () => {
  const tool = (dataset = buildDataset()) =>
    new GetUnitPerformanceTool({
      load: jest.fn(async () => dataset),
    } as unknown as AnalyticsDataService);

  it("devuelve el rendimiento de cada unidad con los mismos cálculos del panel", async () => {
    const output = await tool().execute(context());

    expect(output.data).toEqual({
      units: [
        { unit: "Unidad 1", averagePercent: 70 },
        { unit: "Unidad 2", averagePercent: null },
      ],
    });
    expect(output.intent).toBe("unit_performance");
    expect(output.incomplete).toBe(false);
    expect(output.sources).toEqual([{ type: "moodle_gradebook", id: 7 }]);
  });

  it("no incluye ids de estudiantes ni de actividades", async () => {
    const output = await tool().execute(context());

    expect(JSON.stringify(output.data)).not.toMatch(/studentid|cmid|"1"|90|60/);
  });

  it("marca incompleto y lo explica si el curso no tiene sílabo revisado", async () => {
    const output = await tool(buildDataset({ units: [], mappings: [] })).execute(context());

    expect(output.incomplete).toBe(true);
    expect(output.data).toMatchObject({ units: [], note: "El curso no tiene un sílabo revisado." });
  });

  it("explica cuando las actividades no están relacionadas con unidades", async () => {
    const output = await tool(buildDataset({ mappings: [] })).execute(context());

    expect(output.data).toMatchObject({
      note: "Las actividades no están relacionadas con unidades.",
    });
    expect(
      (output.data as { units: { averagePercent: number | null }[] }).units.every(
        (u) => u.averagePercent === null,
      ),
    ).toBe(true);
  });

  it("marca incompleto si no se pudieron leer las notas, sin inventar un valor", async () => {
    const output = await tool(buildDataset({ grades: null })).execute(context());

    expect(output.incomplete).toBe(true);
    expect(
      (output.data as { units: { averagePercent: number | null }[] }).units.every(
        (u) => u.averagePercent === null,
      ),
    ).toBe(true);
  });
});
