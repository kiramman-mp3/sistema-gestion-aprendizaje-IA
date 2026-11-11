import type { Grade, MoodleActivity } from "@smart-lms/contracts";
import {
  PARTICIPATION_WINDOW_DAYS,
  type AnalyticsDataset,
  type Indicator,
} from "./analytics.types";

const DAY_MS = 24 * 60 * 60 * 1000;

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const percentOf = (part: number, whole: number): number | null =>
  whole > 0 ? round2((part / whole) * 100) : null;

function average(values: number[]): number | null {
  return values.length > 0 ? round2(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

/** Nota como porcentaje de la nota máxima; las notas ausentes o sin máximo no entran. */
export function gradePercent(grade: Grade): number | null {
  return grade.grade !== null && grade.grademax !== null && grade.grademax > 0
    ? (grade.grade / grade.grademax) * 100
    : null;
}

/** Tareas visibles cuya fecha de entrega ya venció: las únicas en las que se puede esperar una entrega. */
export function dueAssignments(data: AnalyticsDataset): MoodleActivity[] {
  return data.activities.filter(
    (activity) =>
      activity.modname === "assign" &&
      activity.visible &&
      activity.duedate !== null &&
      new Date(activity.duedate).getTime() < data.now.getTime() &&
      data.submissions?.has(activity.cmid),
  );
}

const DEFINITIONS = {
  delivery:
    "Entregas recibidas ÷ entregas esperadas × 100. Esperadas: estudiantes matriculados × tareas visibles con fecha de entrega vencida. Una entrega cuenta si está enviada o calificada.",
  pending: "Entregas enviadas que todavía no tienen calificación.",
  average:
    "Promedio simple de las notas ya puestas, cada una como porcentaje de la nota máxima de su actividad. Las actividades sin nota no cuentan como cero.",
  participation: `Estudiantes que entraron al curso en los últimos ${PARTICIPATION_WINDOW_DAYS} días ÷ estudiantes matriculados × 100. Quien nunca entró cuenta como no participante.`,
  completion:
    "Actividades marcadas como completadas ÷ actividades con seguimiento de finalización × 100, sobre todos los estudiantes.",
  unit: "Promedio de las notas (en porcentaje de la nota máxima) de las actividades relacionadas con la unidad. Sin valor si ninguna tiene nota.",
  daysSinceAccess:
    "Días desde el último acceso del estudiante al curso. Sin valor si nunca entró o no hay dato.",
} as const;

/** Indicadores del curso completo (RF-15). Un indicador sin datos lleva `value: null`. */
export function computeCourseIndicators(data: AnalyticsDataset): Indicator[] {
  const students = new Set(data.studentIds);
  const indicators: Indicator[] = [];

  // Porcentaje de entregas
  let delivery: number | null = null;
  if (data.submissions && students.size > 0) {
    const due = dueAssignments(data);
    const delivered = due.reduce(
      (total, activity) =>
        total +
        data
          .submissions!.get(activity.cmid)!
          .filter(
            (row) =>
              students.has(row.studentid) &&
              (row.status === "submitted" || row.status === "graded"),
          ).length,
      0,
    );
    delivery = percentOf(delivered, due.length * students.size);
  }
  indicators.push({
    key: "delivery_rate",
    label: "Entregas recibidas",
    value: delivery,
    unit: "%",
    definition: DEFINITIONS.delivery,
  });

  // Pendientes de calificar
  indicators.push({
    key: "pending_grading",
    label: "Entregas por calificar",
    value: data.pending ? data.pending.length : null,
    unit: "entregas",
    definition: DEFINITIONS.pending,
  });

  // Promedio de notas
  const percents = (data.grades ?? [])
    .filter((grade) => students.has(grade.studentid))
    .map(gradePercent)
    .filter((value): value is number => value !== null);
  indicators.push({
    key: "average_grade_percent",
    label: "Promedio de notas",
    value: data.grades ? average(percents) : null,
    unit: "%",
    definition: DEFINITIONS.average,
  });

  // Participación
  let participation: number | null = null;
  if (data.lastAccess && students.size > 0) {
    const since = data.now.getTime() - PARTICIPATION_WINDOW_DAYS * DAY_MS;
    const active = new Set(
      data.lastAccess
        .filter((row) => row.lastaccess !== null && new Date(row.lastaccess).getTime() >= since)
        .map((row) => row.studentid),
    );
    participation = percentOf([...active].filter((id) => students.has(id)).length, students.size);
  }
  indicators.push({
    key: "participation_rate",
    label: "Participación",
    value: participation,
    unit: "%",
    definition: DEFINITIONS.participation,
  });

  // Finalización
  const completionRows = (data.completion ?? []).filter((row) => students.has(row.studentid));
  indicators.push({
    key: "completion_rate",
    label: "Actividades completadas",
    value: data.completion
      ? percentOf(completionRows.filter((row) => row.completed).length, completionRows.length)
      : null,
    unit: "%",
    definition: DEFINITIONS.completion,
  });

  // Rendimiento por unidad (RF-15): usa la relación actividad ↔ unidad del sílabo revisado
  for (const unit of data.units) {
    const cmids = new Set(
      data.mappings.filter((mapping) => mapping.unitRef === unit.unitRef).map((m) => m.cmid),
    );
    const unitPercents = (data.grades ?? [])
      .filter((grade) => cmids.has(grade.cmid) && students.has(grade.studentid))
      .map(gradePercent)
      .filter((value): value is number => value !== null);
    indicators.push({
      key: `unit_average:${unit.unitRef}`,
      label: `Rendimiento en ${unit.title}`,
      value: data.grades ? average(unitPercents) : null,
      unit: "%",
      definition: DEFINITIONS.unit,
    });
  }

  return indicators;
}

/** Indicadores de un estudiante (RF-17), con las mismas definiciones que los del curso. */
export function computeStudentIndicators(data: AnalyticsDataset, studentId: number): Indicator[] {
  const own = <T extends { studentid: number }>(rows: T[] | null): T[] | null =>
    rows ? rows.filter((row) => row.studentid === studentId) : null;

  let delivery: number | null = null;
  if (data.submissions) {
    const due = dueAssignments(data);
    const delivered = due.filter((activity) =>
      data
        .submissions!.get(activity.cmid)!
        .some(
          (row) =>
            row.studentid === studentId && (row.status === "submitted" || row.status === "graded"),
        ),
    ).length;
    delivery = percentOf(delivered, due.length);
  }

  const grades = own(data.grades);
  const completion = own(data.completion);
  const access = data.lastAccess?.find((row) => row.studentid === studentId);
  const daysSince =
    access && access.lastaccess !== null
      ? Math.max(
          0,
          Math.floor((data.now.getTime() - new Date(access.lastaccess).getTime()) / DAY_MS),
        )
      : null;

  return [
    {
      key: "delivery_rate",
      label: "Entregas realizadas",
      value: delivery,
      unit: "%",
      definition:
        "Entregas del estudiante ÷ tareas visibles con fecha de entrega vencida × 100. Una entrega cuenta si está enviada o calificada.",
    },
    {
      key: "average_grade_percent",
      label: "Promedio de notas",
      value: grades
        ? average(grades.map(gradePercent).filter((value): value is number => value !== null))
        : null,
      unit: "%",
      definition: DEFINITIONS.average,
    },
    {
      key: "completion_rate",
      label: "Actividades completadas",
      value: completion
        ? percentOf(completion.filter((row) => row.completed).length, completion.length)
        : null,
      unit: "%",
      definition:
        "Actividades completadas por el estudiante ÷ actividades con seguimiento de finalización × 100.",
    },
    {
      key: "days_since_last_access",
      label: "Días desde el último acceso",
      value: daysSince,
      unit: "días",
      definition: DEFINITIONS.daysSinceAccess,
    },
  ];
}
