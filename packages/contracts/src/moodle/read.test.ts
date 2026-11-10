import { describe, expect, it } from "vitest";
import {
  getCompletionResponseSchema,
  getGradesResponseSchema,
  getLastAccessResponseSchema,
  getPendingGradingResponseSchema,
  getSubmissionsResponseSchema,
  listActivitiesResponseSchema,
  listStudentsResponseSchema,
  MOODLE_READ_FUNCTIONS,
  readByActivityParamsSchema,
  readOptionalActivityParamsSchema,
  readParamsSchema,
} from "./read.js";

describe("funciones de lectura de Moodle", () => {
  it("todos los nombres empiezan con el prefijo del plugin", () => {
    for (const name of Object.values(MOODLE_READ_FUNCTIONS)) {
      expect(name).toMatch(/^local_ai_assistant_[a-z_]+$/);
    }
  });

  describe("parámetros", () => {
    it("exigen userid y courseid positivos y rechazan campos de más", () => {
      expect(readParamsSchema.safeParse({ userid: 42, courseid: 7 }).success).toBe(true);
      expect(readParamsSchema.safeParse({ userid: 0, courseid: 7 }).success).toBe(false);
      expect(readParamsSchema.safeParse({ userid: 42 }).success).toBe(false);
      expect(readParamsSchema.safeParse({ userid: 42, courseid: 7, extra: 1 }).success).toBe(false);
    });

    it("cmid es obligatorio u opcional según la función", () => {
      expect(readByActivityParamsSchema.safeParse({ userid: 1, courseid: 2 }).success).toBe(false);
      expect(readByActivityParamsSchema.safeParse({ userid: 1, courseid: 2, cmid: 3 }).success).toBe(
        true,
      );
      expect(readOptionalActivityParamsSchema.safeParse({ userid: 1, courseid: 2 }).success).toBe(
        true,
      );
    });
  });

  describe("actividades", () => {
    const activity = {
      cmid: 15,
      modname: "assign",
      name: "Tarea 3",
      sectionnum: 2,
      visible: true,
      duedate: "2026-12-04T23:59:00Z",
      maxgrade: 10,
    };

    it("acepta una lista válida, también sin fecha ni nota máxima", () => {
      expect(
        listActivitiesResponseSchema.safeParse({
          truncated: false,
          activities: [activity, { ...activity, cmid: 16, duedate: null, maxgrade: null }],
        }).success,
      ).toBe(true);
    });

    it("rechaza fechas sin zona horaria y tipos de módulo con caracteres raros", () => {
      expect(
        listActivitiesResponseSchema.safeParse({
          truncated: false,
          activities: [{ ...activity, duedate: "2026-12-04 23:59" }],
        }).success,
      ).toBe(false);
      expect(
        listActivitiesResponseSchema.safeParse({
          truncated: false,
          activities: [{ ...activity, modname: "assign; drop" }],
        }).success,
      ).toBe(false);
    });
  });

  describe("privacidad: solo ids, nunca datos personales", () => {
    it.each([
      ["estudiantes", listStudentsResponseSchema, "students", { studentid: 1 }],
      [
        "entregas",
        getSubmissionsResponseSchema,
        "submissions",
        { studentid: 1, status: "submitted", submittedat: null, late: false },
      ],
      [
        "pendientes",
        getPendingGradingResponseSchema,
        "pending",
        { cmid: 1, studentid: 1, submittedat: null },
      ],
      [
        "notas",
        getGradesResponseSchema,
        "grades",
        { cmid: 1, studentid: 1, grade: 8, grademax: 10, gradedat: null },
      ],
      [
        "completado",
        getCompletionResponseSchema,
        "completion",
        { cmid: 1, studentid: 1, completed: true, completedat: null },
      ],
      [
        "accesos",
        getLastAccessResponseSchema,
        "lastaccess",
        { studentid: 1, lastaccess: "2026-11-09T10:00:00Z" },
      ],
    ])("%s: acepta la fila válida y rechaza nombre, correo o cédula", (_name, schema, key, row) => {
      const body = (item: object) => ({
        truncated: false,
        ...(key === "submissions" ? { cmid: 1 } : {}),
        [key]: [item],
      });
      expect(schema.safeParse(body(row)).success).toBe(true);
      for (const field of ["fullname", "firstname", "email", "idnumber"]) {
        expect(schema.safeParse(body({ ...row, [field]: "dato personal" })).success).toBe(false);
      }
    });
  });

  describe("notas", () => {
    it("distingue una nota de cero de una nota ausente", () => {
      const row = { cmid: 1, studentid: 1, grademax: 10, gradedat: null };
      const parse = (grade: number | null) =>
        getGradesResponseSchema.parse({ truncated: false, grades: [{ ...row, grade }] });

      expect(parse(0).grades[0]!.grade).toBe(0);
      expect(parse(null).grades[0]!.grade).toBeNull();
    });

    it("rechaza una nota que no es número", () => {
      expect(
        getGradesResponseSchema.safeParse({
          truncated: false,
          grades: [{ cmid: 1, studentid: 1, grade: "8", grademax: 10, gradedat: null }],
        }).success,
      ).toBe(false);
    });
  });

  describe("entregas", () => {
    it("solo acepta los estados definidos", () => {
      const parse = (status: string) =>
        getSubmissionsResponseSchema.safeParse({
          cmid: 1,
          truncated: false,
          submissions: [{ studentid: 1, status, submittedat: null, late: false }],
        }).success;

      for (const status of ["new", "draft", "submitted", "graded", "missing"]) {
        expect(parse(status)).toBe(true);
      }
      expect(parse("overdue")).toBe(false);
    });
  });

  it("exige el indicador de recorte", () => {
    expect(listStudentsResponseSchema.safeParse({ students: [] }).success).toBe(false);
  });
});
