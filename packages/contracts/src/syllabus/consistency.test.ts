import { describe, expect, it } from "vitest";
import { findConsistencyIssues } from "./consistency.js";
import { buildSyllabusExtraction } from "./fixtures.js";

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe("findConsistencyIssues", () => {
  it("no reporta problemas en una extracción coherente", () => {
    expect(findConsistencyIssues(buildSyllabusExtraction())).toEqual([]);
  });

  it("detecta resultados de aprendizaje repetidos", () => {
    const syllabus = buildSyllabusExtraction();
    syllabus.learningOutcomes.push({ id: "RA1", description: "Duplicado" });

    expect(codes(findConsistencyIssues(syllabus))).toContain("DUPLICATE_LEARNING_OUTCOME_ID");
  });

  it("detecta referencias a resultados inexistentes", () => {
    const syllabus = buildSyllabusExtraction();
    syllabus.gradingPeriods[0]!.units[0]!.activities[0]!.learningOutcomeIds = ["RA9"];

    const issues = findConsistencyIssues(syllabus);
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "UNKNOWN_LEARNING_OUTCOME",
        path: "gradingPeriods[0].units[0].activities[0].learningOutcomeIds[0]",
      }),
    );
  });

  it("detecta actividades sin resultado de aprendizaje", () => {
    const syllabus = buildSyllabusExtraction();
    const unit = syllabus.gradingPeriods[0]!.units[0]!;
    unit.learningOutcomeIds = [];
    unit.activities[0]!.learningOutcomeIds = [];

    expect(codes(findConsistencyIssues(syllabus))).toContain("ACTIVITY_WITHOUT_LEARNING_OUTCOME");
  });

  it("acepta una actividad sin resultado propio si su unidad lo tiene", () => {
    const syllabus = buildSyllabusExtraction();
    syllabus.gradingPeriods[0]!.units[0]!.activities[0]!.learningOutcomeIds = [];

    expect(codes(findConsistencyIssues(syllabus))).not.toContain(
      "ACTIVITY_WITHOUT_LEARNING_OUTCOME",
    );
  });

  it("detecta periodos cuyas ponderaciones no suman 100", () => {
    const syllabus = buildSyllabusExtraction();
    syllabus.gradingPeriods[1]!.weight = 40;

    expect(codes(findConsistencyIssues(syllabus))).toContain("GRADING_PERIOD_WEIGHTS_NOT_100");
  });

  it("no evalúa la suma si alguna ponderación de periodo es nula", () => {
    const syllabus = buildSyllabusExtraction();
    syllabus.gradingPeriods[1]!.weight = null;

    expect(codes(findConsistencyIssues(syllabus))).not.toContain("GRADING_PERIOD_WEIGHTS_NOT_100");
  });

  it("detecta actividades de un periodo que suman más de 100", () => {
    const syllabus = buildSyllabusExtraction();
    const unit = syllabus.gradingPeriods[0]!.units[0]!;
    unit.activities.push({ ...unit.activities[0]!, title: "Extra", weight: 80 });

    expect(codes(findConsistencyIssues(syllabus))).toContain("ACTIVITY_WEIGHTS_EXCEED_100");
  });

  it("detecta unidades con fechas invertidas", () => {
    const syllabus = buildSyllabusExtraction();
    const unit = syllabus.gradingPeriods[0]!.units[0]!;
    unit.startDate = "2026-12-20";
    unit.endDate = "2026-12-01";

    expect(codes(findConsistencyIssues(syllabus))).toContain("UNIT_DATES_REVERSED");
  });

  it("detecta fechas de entrega fuera de la unidad", () => {
    const syllabus = buildSyllabusExtraction();
    syllabus.gradingPeriods[0]!.units[0]!.activities[0]!.suggestedDueDate = "2027-01-15";

    expect(codes(findConsistencyIssues(syllabus))).toContain("DUE_DATE_OUTSIDE_UNIT");
  });
});
