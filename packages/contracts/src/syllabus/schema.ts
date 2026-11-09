import { z } from "zod";

/**
 * Esquema v1 de la extracción estructurada de un sílabo.
 *
 * Reglas del documento de requisitos (sección 6.2):
 * - No se inventan fechas, ponderaciones ni actividades: si el sílabo no las trae, el valor es `null`.
 * - Los campos ausentes o dudosos se registran en `uncertainFields` para revisión docente.
 * - Cada dato relevante puede citar su origen en `sourceReferences`.
 */
export const SYLLABUS_SCHEMA_VERSION = "1.0" as const;

/** Tipos de actividad que el generador puede proponer; el mapeo a módulos de Moodle depende de D-05. */
export const ACTIVITY_TYPES = [
  "assignment",
  "forum",
  "quiz",
  "exam",
  "practice",
  "project",
  "resource",
  "other",
] as const;

const nonEmptyText = z.string().trim().min(1);

/** Ponderación en porcentaje (0–100) o `null` cuando el sílabo no la indica. */
const weight = z.number().min(0).max(100).nullable();

/** Fecha ISO `AAAA-MM-DD` o `null` cuando el sílabo no la indica. */
const isoDate = z.iso.date().nullable();

/** Identificador de resultado de aprendizaje, por ejemplo `RA1`. */
const learningOutcomeId = z.string().regex(/^[A-Za-z0-9._-]+$/);

export const sourceReferenceSchema = z.object({
  /** Ruta JSON del dato al que se refiere la cita, por ejemplo `learningOutcomes[0]`. */
  path: nonEmptyText,
  page: z.number().int().positive().nullable(),
  excerpt: z.string().max(500).nullable(),
});

export const uncertainFieldSchema = z.object({
  path: nonEmptyText,
  reason: z.enum(["missing", "ambiguous", "low_confidence", "inconsistent"]),
  note: z.string().max(500).nullable(),
});

export const learningOutcomeSchema = z.object({
  id: learningOutcomeId,
  description: nonEmptyText,
});

export const activitySchema = z.object({
  title: nonEmptyText,
  type: z.enum(ACTIVITY_TYPES),
  description: z.string().nullable(),
  suggestedDueDate: isoDate,
  weight,
  learningOutcomeIds: z.array(learningOutcomeId),
  requiresTeacherReview: z.boolean(),
});

export const unitSchema = z.object({
  title: nonEmptyText,
  topics: z.array(nonEmptyText),
  learningOutcomeIds: z.array(learningOutcomeId),
  startDate: isoDate,
  endDate: isoDate,
  activities: z.array(activitySchema),
});

/** Periodo de calificación; en régimen LOES suele ser un parcial (D-04). */
export const gradingPeriodSchema = z.object({
  name: nonEmptyText,
  weight,
  units: z.array(unitSchema),
});

export const assessmentInstrumentSchema = z.object({
  name: nonEmptyText,
  weight,
});

export const syllabusExtractionSchema = z.object({
  schemaVersion: z.literal(SYLLABUS_SCHEMA_VERSION),
  course: z.object({
    name: nonEmptyText,
    code: z.string().nullable(),
    period: z.string().nullable(),
    teacher: z.string().nullable(),
    generalObjective: z.string().nullable(),
  }),
  learningOutcomes: z.array(learningOutcomeSchema),
  gradingPeriods: z.array(gradingPeriodSchema),
  methodologies: z.array(nonEmptyText),
  resources: z.array(nonEmptyText),
  assessmentInstruments: z.array(assessmentInstrumentSchema),
  bibliography: z.array(nonEmptyText),
  uncertainFields: z.array(uncertainFieldSchema),
  sourceReferences: z.array(sourceReferenceSchema),
});

export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export type SourceReference = z.infer<typeof sourceReferenceSchema>;
export type UncertainField = z.infer<typeof uncertainFieldSchema>;
export type LearningOutcome = z.infer<typeof learningOutcomeSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type Unit = z.infer<typeof unitSchema>;
export type GradingPeriod = z.infer<typeof gradingPeriodSchema>;
export type AssessmentInstrument = z.infer<typeof assessmentInstrumentSchema>;
export type SyllabusExtraction = z.infer<typeof syllabusExtractionSchema>;
