import type { ProposalItemType } from "../generated/prisma/enums";
import type { ProposalPolicy } from "./proposal-policy";

/** Lo que el validador necesita de un elemento; coincide con `ProposalItem` del contrato. */
export interface ProposalItemData {
  id: string;
  parentId: string | null;
  itemType: ProposalItemType;
  title: string;
  position: number;
  unitRef: string;
  learningOutcomeIds: string[];
  weight: number | null;
}

export type ProposalIssueCode =
  | "EMPTY_PROPOSAL"
  | "EMPTY_TITLE"
  | "ITEM_TYPE_NOT_ENABLED"
  | "PERIOD_WEIGHTS_EXCEED_TOTAL"
  | "PERIOD_WEIGHTS_NOT_TOTAL"
  | "ACTIVITY_WITHOUT_OUTCOME"
  | "SECTION_WITHOUT_ACTIVITIES";

export interface ProposalIssue {
  code: ProposalIssueCode;
  /** `error` impide aprobar la propuesta; `warning` la marca para revisión. */
  severity: "error" | "warning";
  itemId: string | null;
  message: string;
}

/**
 * Revisa una propuesta contra la política institucional y la regla de vínculo con resultados de
 * aprendizaje (RF-07). Solo informa: nunca corrige ni completa datos.
 *
 * Los errores impiden aprobar; las advertencias piden la atención del docente.
 */
export function findProposalIssues(
  items: readonly ProposalItemData[],
  policy: ProposalPolicy,
): ProposalIssue[] {
  const issues: ProposalIssue[] = [];
  const sections = items.filter((item) => item.itemType === "SECTION");

  if (sections.length === 0) {
    issues.push({
      code: "EMPTY_PROPOSAL",
      severity: "error",
      itemId: null,
      message: "La propuesta no tiene secciones.",
    });
  }

  for (const item of items) {
    if (item.title.trim() === "") {
      issues.push({
        code: "EMPTY_TITLE",
        severity: "error",
        itemId: item.id,
        message: "Un elemento no tiene título.",
      });
    }
    if (!policy.enabledItemTypes.includes(item.itemType)) {
      issues.push({
        code: "ITEM_TYPE_NOT_ENABLED",
        severity: "error",
        itemId: item.id,
        message: `"${item.title}" es de un tipo que la institución no permite crear (${item.itemType}).`,
      });
    }
    if (item.itemType !== "SECTION" && item.learningOutcomeIds.length === 0) {
      issues.push({
        code: "ACTIVITY_WITHOUT_OUTCOME",
        severity: "warning",
        itemId: item.id,
        message: `"${item.title}" no está vinculada a un resultado de aprendizaje.`,
      });
    }
  }

  for (const section of sections) {
    if (!items.some((item) => item.parentId === section.id)) {
      issues.push({
        code: "SECTION_WITHOUT_ACTIVITIES",
        severity: "warning",
        itemId: section.id,
        message: `La sección "${section.title}" no tiene actividades.`,
      });
    }
  }

  issues.push(...findWeightIssues(items, policy));
  return issues;
}

/** Periodo de calificación al que pertenece un elemento, según la ruta de su unidad. */
export function periodOf(unitRef: string): string {
  return /^gradingPeriods\[\d+\]/.exec(unitRef)?.[0] ?? "other";
}

function findWeightIssues(
  items: readonly ProposalItemData[],
  policy: ProposalPolicy,
): ProposalIssue[] {
  const periods = new Map<string, ProposalItemData[]>();
  for (const item of items) {
    if (item.itemType === "SECTION") continue;
    const period = periodOf(item.unitRef);
    periods.set(period, [...(periods.get(period) ?? []), item]);
  }

  const issues: ProposalIssue[] = [];
  for (const [period, activities] of periods) {
    const weights = activities.map((activity) => activity.weight);
    const total = weights.reduce<number>((sum, weight) => sum + (weight ?? 0), 0);
    const label = period === "other" ? "las actividades sin periodo" : describePeriod(period);

    if (total > policy.periodWeightTotal + policy.weightTolerance) {
      issues.push({
        code: "PERIOD_WEIGHTS_EXCEED_TOTAL",
        severity: "error",
        itemId: null,
        message: `Las ponderaciones de ${label} suman ${round(total)}, más de ${policy.periodWeightTotal}.`,
      });
    } else if (
      weights.every((weight) => weight !== null) &&
      Math.abs(total - policy.periodWeightTotal) > policy.weightTolerance
    ) {
      issues.push({
        code: "PERIOD_WEIGHTS_NOT_TOTAL",
        severity: "warning",
        itemId: null,
        message: `Las ponderaciones de ${label} suman ${round(total)} en lugar de ${policy.periodWeightTotal}.`,
      });
    }
  }
  return issues;
}

function describePeriod(period: string): string {
  const index = Number(/\d+/.exec(period)?.[0] ?? 0);
  return `el periodo ${index + 1}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
