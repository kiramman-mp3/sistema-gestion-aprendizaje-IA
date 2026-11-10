import { ACTIVITY_TYPES, buildSyllabusExtraction } from "@smart-lms/contracts";
import { ACTIVITY_TYPE_TO_ITEM_TYPE } from "./activity-type-map";
import { generateProposalItems } from "./proposal-generator";

describe("generateProposalItems", () => {
  it("crea una sección por unidad y una actividad hija por actividad, en orden", () => {
    const items = generateProposalItems(buildSyllabusExtraction());

    expect(items.map((item) => [item.itemType, item.title, item.parentKey])).toEqual([
      ["SECTION", "Requisitos", null],
      ["ASSIGN", "Especificación de requisitos", "gradingPeriods[0].units[0]"],
      ["SECTION", "Arquitectura", null],
      ["ASSIGN", "Documento de arquitectura", "gradingPeriods[1].units[0]"],
    ]);
    expect(items.map((item) => item.position)).toEqual([0, 1, 2, 3]);
  });

  it("guarda la ruta de la unidad para ubicar el periodo", () => {
    const items = generateProposalItems(buildSyllabusExtraction());

    expect(items.map((item) => item.unitRef)).toEqual([
      "gradingPeriods[0].units[0]",
      "gradingPeriods[0].units[0]",
      "gradingPeriods[1].units[0]",
      "gradingPeriods[1].units[0]",
    ]);
  });

  it("pone los temas de la unidad en la descripción de la sección", () => {
    const [section] = generateProposalItems(buildSyllabusExtraction());

    expect(section?.description).toBe("• Elicitación\n• Historias de usuario");
  });

  it("no inventa fechas ni ponderaciones: usa las de la extracción o null", () => {
    const items = generateProposalItems(buildSyllabusExtraction());
    const [, first, , second] = items;

    expect(first).toMatchObject({ dueDate: "2026-12-04", weight: 30 });
    expect(second).toMatchObject({ dueDate: null, weight: null });
    expect(items.filter((item) => item.itemType === "SECTION")).toEqual([
      expect.objectContaining({ dueDate: null, weight: null }),
      expect.objectContaining({ dueDate: null, weight: null }),
    ]);
  });

  it("vincula cada actividad a un resultado de aprendizaje y hereda los de la unidad si no tiene", () => {
    const extraction = buildSyllabusExtraction();
    const activity = extraction.gradingPeriods[0]!.units[0]!.activities[0]!;
    activity.learningOutcomeIds = [];

    const [, generated] = generateProposalItems(extraction);

    expect(generated?.learningOutcomeIds).toEqual(["RA1"]);
  });

  it("deja la actividad sin resultados si ni ella ni su unidad los tienen", () => {
    const extraction = buildSyllabusExtraction();
    const unit = extraction.gradingPeriods[0]!.units[0]!;
    unit.learningOutcomeIds = [];
    unit.activities[0]!.learningOutcomeIds = [];

    const [, generated] = generateProposalItems(extraction);

    expect(generated?.learningOutcomeIds).toEqual([]);
  });

  it("una unidad sin actividades produce solo la sección", () => {
    const extraction = buildSyllabusExtraction();
    extraction.gradingPeriods[1]!.units[0]!.activities = [];

    const items = generateProposalItems(extraction);

    expect(items.map((item) => item.itemType)).toEqual(["SECTION", "ASSIGN", "SECTION"]);
  });

  it("una extracción sin periodos produce una propuesta vacía", () => {
    expect(generateProposalItems(buildSyllabusExtraction({ gradingPeriods: [] }))).toEqual([]);
  });

  it("no comparte arreglos con la extracción", () => {
    const extraction = buildSyllabusExtraction();
    const [section] = generateProposalItems(extraction);

    section?.learningOutcomeIds.push("RA9");

    expect(extraction.gradingPeriods[0]!.units[0]!.learningOutcomeIds).toEqual(["RA1"]);
  });

  it("es determinista", () => {
    const extraction = buildSyllabusExtraction();

    expect(generateProposalItems(extraction)).toEqual(generateProposalItems(extraction));
  });
});

describe("ACTIVITY_TYPE_TO_ITEM_TYPE", () => {
  it("cubre todos los tipos de actividad del esquema v1", () => {
    expect(Object.keys(ACTIVITY_TYPE_TO_ITEM_TYPE).sort()).toEqual([...ACTIVITY_TYPES].sort());
  });

  it("asigna el elemento de Moodle esperado a cada tipo (D-05 provisional)", () => {
    expect(ACTIVITY_TYPE_TO_ITEM_TYPE).toEqual({
      assignment: "ASSIGN",
      practice: "ASSIGN",
      project: "ASSIGN",
      quiz: "QUIZ",
      exam: "QUIZ",
      forum: "FORUM",
      resource: "PAGE",
      other: "LABEL",
    });
  });

  it("ninguna actividad se convierte en sección", () => {
    expect(Object.values(ACTIVITY_TYPE_TO_ITEM_TYPE)).not.toContain("SECTION");
  });
});
