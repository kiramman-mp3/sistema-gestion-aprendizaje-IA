import { describe, expect, it } from "vitest";
import {
  aggregateEvaluations,
  evaluateExtraction,
  matchCounts,
  normalizeForMatch,
  toMetrics,
} from "./evaluation.js";
import { buildSyllabusExtraction } from "./fixtures.js";

describe("normalizeForMatch", () => {
  it("ignora tildes, mayúsculas, signos y espacios", () => {
    expect(normalizeForMatch("  Ingeniería   de Requisitos: ¡Unidad 1! ")).toBe(
      "ingenieria de requisitos unidad 1",
    );
  });
});

describe("matchCounts", () => {
  it("cuenta verdaderos positivos, falsos positivos y falsos negativos", () => {
    expect(matchCounts(["A", "B", "C"], ["a", "B", "Z"])).toEqual({ tp: 2, fp: 1, fn: 1 });
  });

  it("empareja cada elemento de la referencia una sola vez", () => {
    expect(matchCounts(["Tarea"], ["Tarea", "tarea", "TAREA"])).toEqual({ tp: 1, fp: 2, fn: 0 });
    expect(matchCounts(["Tarea", "Tarea"], ["Tarea"])).toEqual({ tp: 1, fp: 0, fn: 1 });
  });

  it("maneja listas vacías", () => {
    expect(matchCounts([], [])).toEqual({ tp: 0, fp: 0, fn: 0 });
    expect(matchCounts(["A"], [])).toEqual({ tp: 0, fp: 0, fn: 1 });
    expect(matchCounts([], ["A"])).toEqual({ tp: 0, fp: 1, fn: 0 });
  });
});

describe("toMetrics", () => {
  it("calcula precisión, exhaustividad y F1 con las fórmulas del documento", () => {
    const metrics = toMetrics({ tp: 8, fp: 2, fn: 4 });

    expect(metrics.precision).toBeCloseTo(0.8);
    expect(metrics.recall).toBeCloseTo(8 / 12);
    expect(metrics.f1).toBeCloseTo((2 * 0.8 * (8 / 12)) / (0.8 + 8 / 12));
  });

  it("da 1 con una extracción perfecta", () => {
    expect(toMetrics({ tp: 5, fp: 0, fn: 0 })).toMatchObject({ precision: 1, recall: 1, f1: 1 });
  });

  it("da F1 de 0 si se extrajo algo pero nada coincide", () => {
    expect(toMetrics({ tp: 0, fp: 3, fn: 3 })).toMatchObject({ precision: 0, recall: 0, f1: 0 });
  });

  it("no inventa una métrica cuando no hay base", () => {
    expect(toMetrics({ tp: 0, fp: 0, fn: 0 })).toMatchObject({
      precision: null,
      recall: null,
      f1: null,
    });
    expect(toMetrics({ tp: 0, fp: 0, fn: 4 })).toMatchObject({ precision: null, recall: 0, f1: 0 });
  });
});

describe("evaluateExtraction", () => {
  it("da F1 de 1 al comparar una extracción consigo misma", () => {
    const extraction = buildSyllabusExtraction();

    const result = evaluateExtraction(extraction, extraction);

    expect(result.units.f1).toBe(1);
    expect(result.learningOutcomes.f1).toBe(1);
    expect(result.activities.f1).toBe(1);
  });

  it("penaliza una unidad inventada y una resultado omitido", () => {
    const expected = buildSyllabusExtraction();
    const actual = buildSyllabusExtraction();
    actual.gradingPeriods[0]!.units.push({
      title: "Unidad inventada",
      topics: [],
      learningOutcomeIds: [],
      startDate: null,
      endDate: null,
      activities: [],
    });
    actual.learningOutcomes = actual.learningOutcomes.slice(0, 1);

    const result = evaluateExtraction(expected, actual);

    expect(result.units).toMatchObject({ tp: 2, fp: 1, fn: 0 });
    expect(result.learningOutcomes).toMatchObject({ tp: 1, fp: 0, fn: 1 });
  });

  it("compara los resultados de aprendizaje por descripción, no por id", () => {
    const expected = buildSyllabusExtraction();
    const actual = buildSyllabusExtraction();
    actual.learningOutcomes = actual.learningOutcomes.map((o, i) => ({ ...o, id: `X${i}` }));

    expect(evaluateExtraction(expected, actual).learningOutcomes.f1).toBe(1);
  });
});

describe("aggregateEvaluations", () => {
  it("suma los conteos en vez de promediar los F1 por documento", () => {
    const perfectSmall = {
      units: toMetrics({ tp: 2, fp: 0, fn: 0 }),
      learningOutcomes: toMetrics({ tp: 1, fp: 0, fn: 0 }),
      activities: toMetrics({ tp: 1, fp: 0, fn: 0 }),
    };
    const weakLarge = {
      units: toMetrics({ tp: 6, fp: 6, fn: 6 }),
      learningOutcomes: toMetrics({ tp: 1, fp: 0, fn: 0 }),
      activities: toMetrics({ tp: 1, fp: 0, fn: 0 }),
    };

    const total = aggregateEvaluations([perfectSmall, weakLarge]);

    expect(total.units).toMatchObject({ tp: 8, fp: 6, fn: 6 });
    // El promedio simple de F1 sería (1 + 0.5) / 2 = 0.75; ponderado por elemento queda en 8/14.
    expect(total.units.f1).toBeCloseTo(8 / 14);
  });
});
