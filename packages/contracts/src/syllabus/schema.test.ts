import { describe, expect, it } from "vitest";
import { buildSyllabusExtraction } from "./fixtures.js";
import { syllabusExtractionSchema } from "./schema.js";

describe("syllabusExtractionSchema", () => {
  it("acepta una extracción válida", () => {
    const result = syllabusExtractionSchema.safeParse(buildSyllabusExtraction());
    expect(result.success).toBe(true);
  });

  it("acepta fechas y ponderaciones nulas cuando el sílabo no las trae", () => {
    const syllabus = buildSyllabusExtraction();
    const period = syllabus.gradingPeriods[0]!;
    period.weight = null;
    period.units[0]!.activities[0]!.suggestedDueDate = null;
    period.units[0]!.activities[0]!.weight = null;

    expect(syllabusExtractionSchema.safeParse(syllabus).success).toBe(true);
  });

  it("rechaza otra versión de esquema", () => {
    const result = syllabusExtractionSchema.safeParse({
      ...buildSyllabusExtraction(),
      schemaVersion: "2.0",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza fechas que no son ISO AAAA-MM-DD", () => {
    const syllabus = buildSyllabusExtraction();
    const raw = structuredClone(syllabus) as unknown as {
      gradingPeriods: { units: { activities: { suggestedDueDate: string }[] }[] }[];
    };
    raw.gradingPeriods[0]!.units[0]!.activities[0]!.suggestedDueDate = "04/12/2026";

    expect(syllabusExtractionSchema.safeParse(raw).success).toBe(false);
  });

  it("rechaza ponderaciones fuera de 0–100", () => {
    const syllabus = buildSyllabusExtraction();
    syllabus.gradingPeriods[0]!.weight = 120;

    expect(syllabusExtractionSchema.safeParse(syllabus).success).toBe(false);
  });

  it("rechaza tipos de actividad desconocidos", () => {
    const raw = structuredClone(buildSyllabusExtraction()) as unknown as {
      gradingPeriods: { units: { activities: { type: string }[] }[] }[];
    };
    raw.gradingPeriods[0]!.units[0]!.activities[0]!.type = "webinar";

    expect(syllabusExtractionSchema.safeParse(raw).success).toBe(false);
  });

  it("rechaza un curso sin nombre", () => {
    const syllabus = buildSyllabusExtraction();
    syllabus.course.name = "   ";

    expect(syllabusExtractionSchema.safeParse(syllabus).success).toBe(false);
  });
});
