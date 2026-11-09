import type { SyllabusExtraction } from "./schema.js";

export type ConsistencyIssueCode =
  | "DUPLICATE_LEARNING_OUTCOME_ID"
  | "UNKNOWN_LEARNING_OUTCOME"
  | "ACTIVITY_WITHOUT_LEARNING_OUTCOME"
  | "GRADING_PERIOD_WEIGHTS_NOT_100"
  | "ACTIVITY_WEIGHTS_EXCEED_100"
  | "UNIT_DATES_REVERSED"
  | "DUE_DATE_OUTSIDE_UNIT";

export interface ConsistencyIssue {
  code: ConsistencyIssueCode;
  path: string;
  message: string;
}

const WEIGHT_TOLERANCE = 0.01;

/**
 * Revisa reglas de negocio que el esquema no puede expresar por sí solo.
 * Devuelve advertencias para marcar en la revisión docente; no corrige ni inventa datos.
 * Las ponderaciones `null` se ignoran: el sílabo no las define y el docente debe completarlas.
 */
export function findConsistencyIssues(syllabus: SyllabusExtraction): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const knownOutcomes = new Set<string>();

  syllabus.learningOutcomes.forEach((outcome, i) => {
    if (knownOutcomes.has(outcome.id)) {
      issues.push({
        code: "DUPLICATE_LEARNING_OUTCOME_ID",
        path: `learningOutcomes[${i}].id`,
        message: `El resultado de aprendizaje ${outcome.id} está repetido.`,
      });
    }
    knownOutcomes.add(outcome.id);
  });

  const checkOutcomeRefs = (ids: string[], path: string) => {
    ids.forEach((id, i) => {
      if (!knownOutcomes.has(id)) {
        issues.push({
          code: "UNKNOWN_LEARNING_OUTCOME",
          path: `${path}.learningOutcomeIds[${i}]`,
          message: `El resultado de aprendizaje ${id} no existe en el sílabo.`,
        });
      }
    });
  };

  const periodWeights = syllabus.gradingPeriods.map((p) => p.weight);
  if (periodWeights.length > 0 && periodWeights.every((w) => w !== null)) {
    const total = sum(periodWeights as number[]);
    if (Math.abs(total - 100) > WEIGHT_TOLERANCE) {
      issues.push({
        code: "GRADING_PERIOD_WEIGHTS_NOT_100",
        path: "gradingPeriods",
        message: `Las ponderaciones de los periodos suman ${total} en lugar de 100.`,
      });
    }
  }

  syllabus.gradingPeriods.forEach((period, p) => {
    const periodPath = `gradingPeriods[${p}]`;
    const activityWeights: number[] = [];

    period.units.forEach((unit, u) => {
      const unitPath = `${periodPath}.units[${u}]`;
      checkOutcomeRefs(unit.learningOutcomeIds, unitPath);

      if (unit.startDate && unit.endDate && unit.startDate > unit.endDate) {
        issues.push({
          code: "UNIT_DATES_REVERSED",
          path: unitPath,
          message: `La unidad "${unit.title}" termina antes de empezar.`,
        });
      }

      unit.activities.forEach((activity, a) => {
        const activityPath = `${unitPath}.activities[${a}]`;
        checkOutcomeRefs(activity.learningOutcomeIds, activityPath);

        if (activity.learningOutcomeIds.length === 0 && unit.learningOutcomeIds.length === 0) {
          issues.push({
            code: "ACTIVITY_WITHOUT_LEARNING_OUTCOME",
            path: activityPath,
            message: `La actividad "${activity.title}" no está vinculada a un resultado de aprendizaje.`,
          });
        }

        const due = activity.suggestedDueDate;
        if (
          due &&
          ((unit.startDate && due < unit.startDate) || (unit.endDate && due > unit.endDate))
        ) {
          issues.push({
            code: "DUE_DATE_OUTSIDE_UNIT",
            path: `${activityPath}.suggestedDueDate`,
            message: `La fecha de "${activity.title}" está fuera del rango de la unidad.`,
          });
        }

        if (activity.weight !== null) activityWeights.push(activity.weight);
      });
    });

    const activityTotal = sum(activityWeights);
    if (activityTotal > 100 + WEIGHT_TOLERANCE) {
      issues.push({
        code: "ACTIVITY_WEIGHTS_EXCEED_100",
        path: periodPath,
        message: `Las ponderaciones de las actividades de "${period.name}" suman ${activityTotal}.`,
      });
    }
  });

  return issues;
}

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}
