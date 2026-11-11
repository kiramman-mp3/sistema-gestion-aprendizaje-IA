import { z } from "zod";

/**
 * Funciones de lectura que el plugin expone al backend (Sprint 8). El backend las llama con el usuario
 * de integración en nombre de un docente; el plugin valida que ese docente tenga permiso en el curso.
 *
 * Reglas del contrato:
 * - Nunca nombres, correos ni cédulas: solo ids de Moodle (ADR-010). Por eso las filas son estrictas:
 *   un campo de más, como `fullname`, hace fallar la validación en vez de pasar de largo.
 * - Fechas en ISO-8601 UTC (`2026-11-10T15:30:00Z`); `null` si no existe.
 * - Una nota ausente es `null`, nunca `0`.
 * - `truncated` es `true` si el plugin cortó la lista por volumen; el backend marca la respuesta como incompleta.
 */
export const MOODLE_READ_FUNCTIONS = {
  listActivities: "local_ai_assistant_list_activities",
  listStudents: "local_ai_assistant_list_students",
  getSubmissions: "local_ai_assistant_get_submissions",
  getPendingGrading: "local_ai_assistant_get_pending_grading",
  getGrades: "local_ai_assistant_get_grades",
  getCompletion: "local_ai_assistant_get_completion",
  getLastAccess: "local_ai_assistant_get_last_access",
} as const;

/** Máximo de filas que devuelve el plugin por llamada; pasado este tope responde `truncated: true`. */
export const MOODLE_READ_MAX_ROWS = 500;

const id = z.number().int().positive();
const utcDate = z.iso.datetime().nullable();
const nameOf = z.string().trim().min(1);

/** Parámetros comunes de toda función de lectura. */
export const readParamsSchema = z.strictObject({
  /** Docente en cuyo nombre se consulta; el plugin comprueba sus permisos en el curso. */
  userid: id,
  courseid: id,
});

export const readByActivityParamsSchema = readParamsSchema.extend({ cmid: id });
export const readOptionalActivityParamsSchema = readParamsSchema.extend({ cmid: id.optional() });

export const SUBMISSION_STATUSES = ["new", "draft", "submitted", "graded", "missing"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const moodleActivitySchema = z.strictObject({
  cmid: id,
  /** Tipo de módulo de Moodle: `assign`, `forum`, `quiz`, `label`, `page`, etc. */
  modname: z.string().regex(/^[a-z_]+$/),
  name: nameOf,
  sectionnum: z.number().int().min(0),
  visible: z.boolean(),
  duedate: utcDate,
  /** Nota máxima si la actividad se califica; `null` si no. */
  maxgrade: z.number().nonnegative().nullable(),
});

export const listActivitiesResponseSchema = z.strictObject({
  truncated: z.boolean(),
  activities: z.array(moodleActivitySchema),
});

export const listStudentsResponseSchema = z.strictObject({
  truncated: z.boolean(),
  students: z.array(z.strictObject({ studentid: id })),
});

export const submissionSchema = z.strictObject({
  studentid: id,
  status: z.enum(SUBMISSION_STATUSES),
  submittedat: utcDate,
  late: z.boolean(),
});

export const getSubmissionsResponseSchema = z.strictObject({
  cmid: id,
  truncated: z.boolean(),
  submissions: z.array(submissionSchema),
});

export const pendingGradingSchema = z.strictObject({
  cmid: id,
  studentid: id,
  submittedat: utcDate,
});

export const getPendingGradingResponseSchema = z.strictObject({
  truncated: z.boolean(),
  pending: z.array(pendingGradingSchema),
});

export const gradeSchema = z.strictObject({
  cmid: id,
  studentid: id,
  /** `null` si no hay nota; un `0` es una nota de cero. */
  grade: z.number().nullable(),
  grademax: z.number().nonnegative().nullable(),
  gradedat: utcDate,
});

export const getGradesResponseSchema = z.strictObject({
  truncated: z.boolean(),
  grades: z.array(gradeSchema),
});

export const completionSchema = z.strictObject({
  cmid: id,
  studentid: id,
  completed: z.boolean(),
  completedat: utcDate,
});

export const getCompletionResponseSchema = z.strictObject({
  truncated: z.boolean(),
  completion: z.array(completionSchema),
});

export const lastAccessSchema = z.strictObject({
  studentid: id,
  lastaccess: utcDate,
});

export const getLastAccessResponseSchema = z.strictObject({
  truncated: z.boolean(),
  lastaccess: z.array(lastAccessSchema),
});

export type MoodleActivity = z.infer<typeof moodleActivitySchema>;
export type Submission = z.infer<typeof submissionSchema>;
export type PendingGrading = z.infer<typeof pendingGradingSchema>;
export type Grade = z.infer<typeof gradeSchema>;
export type Completion = z.infer<typeof completionSchema>;
export type LastAccess = z.infer<typeof lastAccessSchema>;
