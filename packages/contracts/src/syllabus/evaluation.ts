import type { SyllabusExtraction } from "./schema.js";

/**
 * Medición de la calidad de la extracción (IA-01 e IA-02 del plan de pruebas; sección 14.2 del documento
 * de requisitos).
 *
 * Criterio de coincidencia, fijado antes de medir: un elemento extraído es verdadero positivo si su texto
 * normalizado (sin tildes, mayúsculas ni signos, espacios simples) es igual al de un elemento de la
 * referencia que aún no se haya emparejado. Unidades y actividades se comparan por título; resultados de
 * aprendizaje por descripción, porque su identificador (`RA1`) es una convención del extractor.
 * Cada elemento de la referencia se empareja una sola vez.
 */
export interface Counts {
  /** Verdaderos positivos: extraídos que coinciden con la referencia. */
  tp: number;
  /** Falsos positivos: extraídos que no están en la referencia (incluye lo inventado). */
  fp: number;
  /** Falsos negativos: elementos de la referencia que no se extrajeron. */
  fn: number;
}

export interface Metrics extends Counts {
  /** `null` cuando no hay base para calcularla (por ejemplo, nada extraído). */
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export const EVALUATED_KINDS = ["units", "learningOutcomes", "activities"] as const;
export type EvaluatedKind = (typeof EVALUATED_KINDS)[number];

export type ExtractionEvaluation = Record<EvaluatedKind, Metrics>;

/** Texto comparable: sin tildes, en minúsculas, sin signos y con espacios simples. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cuenta verdaderos positivos, falsos positivos y falsos negativos emparejando uno a uno. */
export function matchCounts(expected: string[], actual: string[]): Counts {
  const pending = new Map<string, number>();
  for (const item of expected.map(normalizeForMatch)) {
    pending.set(item, (pending.get(item) ?? 0) + 1);
  }
  let tp = 0;
  for (const item of actual.map(normalizeForMatch)) {
    const left = pending.get(item) ?? 0;
    if (left > 0) {
      pending.set(item, left - 1);
      tp++;
    }
  }
  return { tp, fp: actual.length - tp, fn: expected.length - tp };
}

/** Precisión, exhaustividad y F1 a partir de los conteos. */
export function toMetrics({ tp, fp, fn }: Counts): Metrics {
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : precision === 0 || recall === 0
        ? 0
        : null;
  return { tp, fp, fn, precision, recall, f1 };
}

function itemsOf(extraction: SyllabusExtraction): Record<EvaluatedKind, string[]> {
  const units = extraction.gradingPeriods.flatMap((period) => period.units);
  return {
    units: units.map((unit) => unit.title),
    learningOutcomes: extraction.learningOutcomes.map((outcome) => outcome.description),
    activities: units.flatMap((unit) => unit.activities.map((activity) => activity.title)),
  };
}

/** Compara la extracción obtenida con la esperada de un solo sílabo. */
export function evaluateExtraction(
  expected: SyllabusExtraction,
  actual: SyllabusExtraction,
): ExtractionEvaluation {
  const want = itemsOf(expected);
  const got = itemsOf(actual);
  return Object.fromEntries(
    EVALUATED_KINDS.map((kind) => [kind, toMetrics(matchCounts(want[kind], got[kind]))]),
  ) as ExtractionEvaluation;
}

/**
 * Métricas de varios sílabos juntas. Se suman los conteos (promedio ponderado por elemento) y no se
 * promedian los F1 por documento: un sílabo con dos unidades no pesa igual que uno con doce.
 */
export function aggregateEvaluations(evaluations: ExtractionEvaluation[]): ExtractionEvaluation {
  return Object.fromEntries(
    EVALUATED_KINDS.map((kind) => [
      kind,
      toMetrics(
        evaluations.reduce<Counts>(
          (total, evaluation) => ({
            tp: total.tp + evaluation[kind].tp,
            fp: total.fp + evaluation[kind].fp,
            fn: total.fn + evaluation[kind].fn,
          }),
          { tp: 0, fp: 0, fn: 0 },
        ),
      ),
    ]),
  ) as ExtractionEvaluation;
}

/** Metas del plan de pruebas (sección 4). Las actividades no tienen meta definida todavía. */
export const EXTRACTION_TARGETS: Partial<Record<EvaluatedKind, number>> = {
  units: 0.85,
  learningOutcomes: 0.8,
};
