import type { Grade, MoodleActivity, Submission } from "@smart-lms/contracts";
import type { AnalyticsDataset } from "./analytics.types";

/**
 * Curso sintético pequeño, pensado para verificar los cálculos a mano (criterio de aceptación del Sprint 10).
 * Hoy: 2026-11-10 12:00 UTC. Estudiantes: 1, 2, 3 y 4.
 *
 * Tareas (assign) vencidas y visibles: 10 (vence 11-01) y 11 (vence 11-05). Fuera del cálculo de entregas:
 * 12 (vence en diciembre), 13 (oculta) y 14 (foro, sin fecha).
 *
 * Entregas de la tarea 10: 1 calificada, 2 enviada, 3 sin entrega, 4 enviada → 3 de 4.
 * Entregas de la tarea 11: 1 enviada, 2 sin entrega, 3 sin entrega, 4 nueva → 1 de 4.
 * Total: 4 de 8 esperadas → 50 %.
 */
export const NOW = new Date("2026-11-10T12:00:00Z");

const activity = (cmid: number, overrides: Partial<MoodleActivity> = {}): MoodleActivity => ({
  cmid,
  modname: "assign",
  name: `Tarea ${cmid}`,
  sectionnum: 1,
  visible: true,
  duedate: "2026-11-01T23:59:00Z",
  maxgrade: 10,
  ...overrides,
});

const submission = (studentid: number, status: Submission["status"]): Submission => ({
  studentid,
  status,
  submittedat: status === "submitted" || status === "graded" ? "2026-10-30T10:00:00Z" : null,
  late: false,
});

const grade = (cmid: number, studentid: number, value: number | null): Grade => ({
  cmid,
  studentid,
  grade: value,
  grademax: 10,
  gradedat: value === null ? null : "2026-11-03T10:00:00Z",
});

export function buildDataset(overrides: Partial<AnalyticsDataset> = {}): AnalyticsDataset {
  return {
    now: NOW,
    activities: [
      activity(10),
      activity(11, { duedate: "2026-11-05T23:59:00Z" }),
      activity(12, { duedate: "2026-12-01T23:59:00Z" }),
      activity(13, { visible: false }),
      activity(14, { modname: "forum", duedate: null, maxgrade: null }),
    ],
    studentIds: [1, 2, 3, 4],
    submissions: new Map([
      [
        10,
        [
          submission(1, "graded"),
          submission(2, "submitted"),
          submission(3, "missing"),
          submission(4, "submitted"),
        ],
      ],
      [
        11,
        [
          submission(1, "submitted"),
          submission(2, "missing"),
          submission(3, "missing"),
          submission(4, "new"),
        ],
      ],
      [12, [submission(1, "new")]],
      [13, [submission(1, "submitted")]],
    ]),
    // Pendientes de calificar: la entrega de 2 en la tarea 10 y la de 1 en la 11.
    pending: [
      { cmid: 10, studentid: 2, submittedat: "2026-10-30T10:00:00Z" },
      { cmid: 11, studentid: 1, submittedat: "2026-11-04T10:00:00Z" },
    ],
    // Porcentajes: 90, 60, (sin nota), 50 en la tarea 10 y 80 en la 11 → promedio (90+60+50+80)/4 = 70.
    grades: [
      grade(10, 1, 9),
      grade(10, 2, 6),
      grade(10, 3, null),
      grade(10, 4, 5),
      grade(11, 1, 8),
    ],
    // Finalización de la tarea 10: completaron 1, 2 y 4; no el 3 → 3 de 4 = 75 %.
    completion: [
      { cmid: 10, studentid: 1, completed: true, completedat: "2026-10-30T10:00:00Z" },
      { cmid: 10, studentid: 2, completed: true, completedat: "2026-10-30T10:00:00Z" },
      { cmid: 10, studentid: 3, completed: false, completedat: null },
      { cmid: 10, studentid: 4, completed: true, completedat: "2026-10-30T10:00:00Z" },
    ],
    // Hace 1, 9 y 40 días; el 4 nunca entró. Con ventana de 14 días participan 1 y 2 → 50 %.
    lastAccess: [
      { studentid: 1, lastaccess: "2026-11-09T12:00:00Z" },
      { studentid: 2, lastaccess: "2026-11-01T12:00:00Z" },
      { studentid: 3, lastaccess: "2026-10-01T12:00:00Z" },
      { studentid: 4, lastaccess: null },
    ],
    // Las tareas 10 y 11 cuentan para la unidad 1; la unidad 2 no tiene actividades.
    mappings: [
      { cmid: 10, unitRef: "gradingPeriods[0].units[0]", learningOutcomeIds: ["RA1"] },
      { cmid: 11, unitRef: "gradingPeriods[0].units[0]", learningOutcomeIds: ["RA1"] },
    ],
    units: [
      { unitRef: "gradingPeriods[0].units[0]", title: "Unidad 1" },
      { unitRef: "gradingPeriods[0].units[1]", title: "Unidad 2" },
    ],
    ...overrides,
  };
}
