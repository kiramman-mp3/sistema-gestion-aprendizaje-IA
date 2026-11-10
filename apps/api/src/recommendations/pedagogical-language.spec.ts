import {
  findLanguageViolations,
  validateRecommendationLanguage,
  type RecommendationContent,
} from "./pedagogical-language";

function content(overrides: Partial<RecommendationContent> = {}): RecommendationContent {
  return {
    evidenceSummary: ["Entregó 2 de 5 actividades de la unidad 2."],
    strengths: ["Participa en el foro de la unidad 1."],
    difficulties: ["No hay entregas registradas en la unidad 3."],
    missingInformation: ["Falta la nota del quiz 2."],
    strategies: ["Proponer una tutoría breve sobre la unidad 3."],
    reinforcementActivities: ["Ejercicios guiados de la unidad 3."],
    followUpIndicators: ["Entregas de la unidad 3 en las próximas dos semanas."],
    ...overrides,
  };
}

describe("findLanguageViolations", () => {
  it.each([
    ["Parece tener dislexia.", "diagnosis"],
    ["Probablemente tiene TDAH", "diagnosis"],
    ["Muestra un trastorno de ansiedad", "diagnosis"],
    ["Presenta depresión", "diagnosis"],
    ["Tiene una discapacidad intelectual", "diagnosis"],
    ["El estudiante es autista", "diagnosis"],
    ["Se le diagnosticó un problema", "diagnosis"],
    ["Es un estudiante vago", "label"],
    ["Está desmotivado y es flojo", "label"],
    ["Es un caso problemático", "label"],
    ["Es incapaz de seguir el ritmo", "judgement"],
    ["No tiene capacidad para la materia", "judgement"],
    ["Es un caso perdido", "judgement"],
  ])("rechaza «%s»", (text, kind) => {
    expect(findLanguageViolations(text).map((v) => v.kind)).toContain(kind);
  });

  it.each([
    "Entregó 2 de 5 actividades.",
    "Su nota en el quiz 1 fue 4,5 sobre 10.",
    "Se sugiere una evaluación diagnóstica de la unidad 3.",
    "Proponer ejercicios guiados y revisar la entrega pendiente.",
    "No hay datos de asistencia.",
    "Participó en el foro y mejoró su nota entre la unidad 1 y la 2.",
  ])("acepta «%s»", (text) => {
    expect(findLanguageViolations(text)).toEqual([]);
  });

  it("no confunde una palabra que solo contiene el término", () => {
    expect(findLanguageViolations("Trabajó en la vagoneta")).toEqual([]);
  });

  it("ignora mayúsculas", () => {
    expect(findLanguageViolations("TIENE DISLEXIA")).toHaveLength(1);
  });
});

describe("validateRecommendationLanguage", () => {
  it("acepta una recomendación que describe hechos y propone estrategias", () => {
    expect(validateRecommendationLanguage(content())).toEqual([]);
  });

  it("indica el campo exacto donde está el término prohibido", () => {
    const violations = validateRecommendationLanguage(
      content({
        difficulties: ["Sin entregas.", "Parece tener dislexia."],
        strategies: ["Tutoría breve.", "Hablar con el estudiante vago."],
      }),
    );

    expect(violations).toEqual([
      { path: "difficulties[1]", kind: "diagnosis", term: "dislexia" },
      { path: "strategies[1]", kind: "label", term: "vago" },
    ]);
  });
});
