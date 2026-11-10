import type {
  Completion,
  Grade,
  LastAccess,
  MoodleActivity,
  PendingGrading,
  Submission,
} from "@smart-lms/contracts";

/** `components/schemas/Indicator` del contrato OpenAPI. */
export interface Indicator {
  key: string;
  label: string;
  /** `null` cuando falta el dato: se muestra como guion, nunca como cero. */
  value: number | null;
  unit: string | null;
  /** Cómo se calcula, para que el docente pueda verificarlo. */
  definition: string;
}

/** Relación de una actividad con una unidad del sílabo revisado (`activity_unit_mappings`). */
export interface ActivityMapping {
  cmid: number;
  unitRef: string;
  learningOutcomeIds: string[];
}

export interface UnitInfo {
  unitRef: string;
  title: string;
}

/**
 * Datos de un curso con los que se calculan indicadores y señales. Cada lectura de Moodle que falló o no
 * existe es `null`: el indicador que depende de ella queda sin valor en lugar de inventarse un cero.
 */
export interface AnalyticsDataset {
  now: Date;
  activities: MoodleActivity[];
  /** Matriculados activos. Solo ids: los nombres no pasan por el backend. */
  studentIds: number[];
  /** Entregas por actividad, solo de tareas (`assign`). */
  submissions: Map<number, Submission[]> | null;
  pending: PendingGrading[] | null;
  grades: Grade[] | null;
  completion: Completion[] | null;
  lastAccess: LastAccess[] | null;
  mappings: ActivityMapping[];
  units: UnitInfo[];
}

/** Días sin entrar al curso a partir de los cuales un estudiante deja de contar como participante. */
export const PARTICIPATION_WINDOW_DAYS = 14;
