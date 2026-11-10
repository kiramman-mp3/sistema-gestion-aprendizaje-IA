import type { Grade } from "@smart-lms/contracts";
import type { AnalyticsDataset } from "./analytics.types";
import { type DifficultyRuleType, type RuleConfig, type RuleParams } from "./difficulty-rules";
import { dueAssignments, gradePercent } from "./indicators";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Una señal avisa de un patrón observable y dice por qué; no es un diagnóstico ni una etiqueta. */
export interface DifficultySignal {
  studentId: number;
  rule: DifficultyRuleType;
  explanation: string;
}

const NOT_DELIVERED = new Set(["missing", "new", "draft"]);

function within(date: string | null, now: Date, windowDays: number | undefined): boolean {
  if (windowDays === undefined) return true;
  if (date === null) return false;
  return new Date(date).getTime() >= now.getTime() - windowDays * DAY_MS;
}

const nameList = (names: string[]): string => {
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${shown} y ${names.length - 3} más` : shown;
};

/** Notas con porcentaje, de un estudiante, dentro de la ventana y en orden cronológico. */
function gradedPercents(data: AnalyticsDataset, studentId: number, windowDays: number | undefined) {
  return (data.grades ?? [])
    .filter(
      (grade: Grade) =>
        grade.studentid === studentId && within(grade.gradedat, data.now, windowDays),
    )
    .map((grade) => ({ grade, percent: gradePercent(grade) }))
    .filter((row): row is { grade: Grade; percent: number } => row.percent !== null)
    .sort(
      (a, b) =>
        (a.grade.gradedat ?? "").localeCompare(b.grade.gradedat ?? "") ||
        a.grade.cmid - b.grade.cmid,
    );
}

function activityName(data: AnalyticsDataset, cmid: number): string {
  return data.activities.find((activity) => activity.cmid === cmid)?.name ?? `actividad ${cmid}`;
}

function missingRequired(
  data: AnalyticsDataset,
  params: RuleParams<"MISSING_REQUIRED">,
): DifficultySignal[] {
  if (!data.submissions) return [];
  const required = params.requiredCmids ? new Set(params.requiredCmids) : null;
  const due = dueAssignments(data).filter(
    (activity) =>
      (!required || required.has(activity.cmid)) &&
      within(activity.duedate, data.now, params.windowDays),
  );

  const signals: DifficultySignal[] = [];
  for (const studentId of data.studentIds) {
    const missing = due.filter((activity) => {
      const row = data.submissions!.get(activity.cmid)?.find((r) => r.studentid === studentId);
      return !row || NOT_DELIVERED.has(row.status);
    });
    if (missing.length >= params.minMissing) {
      signals.push({
        studentId,
        rule: "MISSING_REQUIRED",
        explanation: `No tiene entrega en ${missing.length} de ${due.length} tareas con fecha vencida (${nameList(missing.map((a) => a.name))}). La regla se activa desde ${params.minMissing}.`,
      });
    }
  }
  return signals;
}

function gradeBelowThreshold(
  data: AnalyticsDataset,
  params: RuleParams<"GRADE_BELOW_THRESHOLD">,
): DifficultySignal[] {
  const signals: DifficultySignal[] = [];
  for (const studentId of data.studentIds) {
    const low = gradedPercents(data, studentId, params.windowDays).filter(
      (row) => row.percent < params.thresholdPercent,
    );
    if (low.length >= params.minActivities) {
      signals.push({
        studentId,
        rule: "GRADE_BELOW_THRESHOLD",
        explanation: `Tiene ${low.length} notas por debajo del ${params.thresholdPercent} % de la nota máxima (${nameList(low.map((row) => `${activityName(data, row.grade.cmid)}: ${Math.round(row.percent)} %`))}). La regla se activa desde ${params.minActivities}.`,
      });
    }
  }
  return signals;
}

function sustainedDecline(
  data: AnalyticsDataset,
  params: RuleParams<"SUSTAINED_DECLINE">,
): DifficultySignal[] {
  const signals: DifficultySignal[] = [];
  for (const studentId of data.studentIds) {
    const recent = gradedPercents(data, studentId, params.windowDays).slice(-params.consecutive);
    const declining =
      recent.length === params.consecutive &&
      recent.every((row, i) => i === 0 || row.percent < recent[i - 1]!.percent);
    if (declining) {
      signals.push({
        studentId,
        rule: "SUSTAINED_DECLINE",
        explanation: `Sus últimas ${params.consecutive} notas bajan una tras otra: ${recent.map((row) => `${Math.round(row.percent)} %`).join(" → ")}.`,
      });
    }
  }
  return signals;
}

function repeatedOutcomeDifficulty(
  data: AnalyticsDataset,
  params: RuleParams<"REPEATED_OUTCOME_DIFFICULTY">,
): DifficultySignal[] {
  const outcomes = new Map<string, Set<number>>();
  for (const mapping of data.mappings) {
    for (const outcome of mapping.learningOutcomeIds) {
      outcomes.set(outcome, (outcomes.get(outcome) ?? new Set()).add(mapping.cmid));
    }
  }

  const signals: DifficultySignal[] = [];
  for (const studentId of data.studentIds) {
    const low = gradedPercents(data, studentId, params.windowDays).filter(
      (row) => row.percent < params.thresholdPercent,
    );
    for (const [outcome, cmids] of [...outcomes].sort(([a], [b]) => a.localeCompare(b))) {
      const inOutcome = low.filter((row) => cmids.has(row.grade.cmid));
      if (inOutcome.length >= params.minActivities) {
        signals.push({
          studentId,
          rule: "REPEATED_OUTCOME_DIFFICULTY",
          explanation: `En el resultado de aprendizaje ${outcome} tiene ${inOutcome.length} notas por debajo del ${params.thresholdPercent} % (${nameList(inOutcome.map((row) => activityName(data, row.grade.cmid)))}). La regla se activa desde ${params.minActivities}.`,
        });
      }
    }
  }
  return signals;
}

/**
 * Evalúa las reglas activas sobre los datos del curso (RF-16). Una señal solo lleva el id del estudiante y la
 * explicación de por qué se activó. Si falta el dato que una regla necesita, la regla no genera señales: la
 * ausencia de datos no es una señal.
 */
export function evaluateSignals(data: AnalyticsDataset, rules: RuleConfig[]): DifficultySignal[] {
  const signals: DifficultySignal[] = [];
  for (const config of rules) {
    if (!config.enabled) continue;
    if (config.rule === "MISSING_REQUIRED") {
      signals.push(...missingRequired(data, config.params as RuleParams<"MISSING_REQUIRED">));
    } else if (config.rule === "GRADE_BELOW_THRESHOLD") {
      signals.push(
        ...gradeBelowThreshold(data, config.params as RuleParams<"GRADE_BELOW_THRESHOLD">),
      );
    } else if (config.rule === "SUSTAINED_DECLINE") {
      signals.push(...sustainedDecline(data, config.params as RuleParams<"SUSTAINED_DECLINE">));
    } else {
      signals.push(
        ...repeatedOutcomeDifficulty(
          data,
          config.params as RuleParams<"REPEATED_OUTCOME_DIFFICULTY">,
        ),
      );
    }
  }
  return signals.sort((a, b) => a.studentId - b.studentId || a.rule.localeCompare(b.rule));
}
