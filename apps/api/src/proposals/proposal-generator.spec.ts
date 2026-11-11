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

describe("generateProposalItems: sílabo sin actividades por unidad", () => {
  /** Un programa analítico sin parciales: un periodo, unidades sin actividades y tres componentes de evaluación. */
  const withoutActivities = () => {
    const extraction = buildSyllabusExtraction();
    extraction.gradingPeriods = [
      {
        name: "JULIO 2026 - DICIEMBRE 2026",
        weight: null,
        units: [
          { ...extraction.gradingPeriods[0]!.units[0]!, title: "Evolución", activities: [] },
          { ...extraction.gradingPeriods[0]!.units[0]!, title: "Filosofía ágil", activities: [] },
        ],
      },
    ];
    extraction.assessmentInstruments = [
      { name: "APRENDIZAJE EN CONTACTO CON EL DOCENTE", weight: 40 },
      { name: "APRENDIZAJE PRÁCTICO EXPERIMENTAL", weight: 30 },
      { name: "APRENDIZAJE AUTÓNOMO", weight: 30 },
    ];
    return extraction;
  };

  it("propone una actividad sugerida por componente en cada unidad, tras la sección", () => {
    const items = generateProposalItems(withoutActivities());

    expect(items.map((item) => [item.itemType, item.title, item.parentKey])).toEqual([
      ["SECTION", "Evolución", null],
      ["QUIZ", "Aprendizaje en contacto con el docente — Evolución", "gradingPeriods[0].units[0]"],
      ["ASSIGN", "Aprendizaje práctico experimental — Evolución", "gradingPeriods[0].units[0]"],
      ["ASSIGN", "Aprendizaje autónomo — Evolución", "gradingPeriods[0].units[0]"],
      ["SECTION", "Filosofía ágil", null],
      [
        "QUIZ",
        "Aprendizaje en contacto con el docente — Filosofía ágil",
        "gradingPeriods[0].units[1]",
      ],
      [
        "ASSIGN",
        "Aprendizaje práctico experimental — Filosofía ágil",
        "gradingPeriods[0].units[1]",
      ],
      ["ASSIGN", "Aprendizaje autónomo — Filosofía ágil", "gradingPeriods[0].units[1]"],
    ]);
    expect(items.map((item) => item.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("las marca como sugeridas, con el porcentaje del componente, y no inventa fecha ni ponderación", () => {
    const [, quiz] = generateProposalItems(withoutActivities());

    expect(quiz?.description).toMatch(
      /^Sugerida a partir del componente de evaluación «APRENDIZAJE EN CONTACTO CON EL DOCENTE» \(40 % de la nota\)/,
    );
    expect(quiz).toMatchObject({ dueDate: null, weight: null });
  });

  it("hereda los resultados de aprendizaje de la unidad", () => {
    const extraction = withoutActivities();
    extraction.gradingPeriods[0]!.units[0]!.learningOutcomeIds = ["RA1", "RA2"];

    const [, suggested] = generateProposalItems(extraction);

    expect(suggested?.learningOutcomeIds).toEqual(["RA1", "RA2"]);
  });

  it("sin ponderación en el componente no escribe porcentaje", () => {
    const extraction = withoutActivities();
    extraction.assessmentInstruments = [{ name: "Portafolio", weight: null }];

    const [, suggested] = generateProposalItems(extraction);

    expect(suggested?.description).toMatch(/«Portafolio» del sílabo/);
    expect(suggested?.description).not.toContain("%");
  });

  it("no repite un componente que el documento lista dos veces", () => {
    const extraction = withoutActivities();
    extraction.assessmentInstruments = [
      { name: "Portafolio", weight: 50 },
      { name: "PORTAFOLIO", weight: 50 },
    ];

    const items = generateProposalItems(extraction);

    expect(items.filter((item) => item.itemType !== "SECTION")).toHaveLength(2);
  });

  it("si alguna unidad trae actividades, el sílabo las define: no se sugiere nada", () => {
    const extraction = withoutActivities();
    extraction.gradingPeriods[0]!.units[1]!.activities =
      buildSyllabusExtraction().gradingPeriods[0]!.units[0]!.activities;

    const items = generateProposalItems(extraction);

    expect(items.some((item) => item.description?.startsWith("Sugerida"))).toBe(false);
  });

  it("sin componentes de evaluación solo hay secciones", () => {
    const extraction = withoutActivities();
    extraction.assessmentInstruments = [];

    expect(generateProposalItems(extraction).every((item) => item.itemType === "SECTION")).toBe(
      true,
    );
  });

  it("la política puede apagarlo", () => {
    const items = generateProposalItems(withoutActivities(), {
      deriveActivitiesFromInstruments: false,
    });

    expect(items.every((item) => item.itemType === "SECTION")).toBe(true);
  });
});
