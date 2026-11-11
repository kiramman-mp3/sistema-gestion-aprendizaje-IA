import { EXTRACTION_SYSTEM_PROMPT } from "./syllabus-prompt";

describe("EXTRACTION_SYSTEM_PROMPT", () => {
  it("manda los componentes de evaluación a los instrumentos y no a los periodos de calificación", () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/assessmentInstruments/);
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/NO son periodos de calificación/);
  });

  it("sin periodos en el documento pide un único periodo sin ponderación con todas las unidades", () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/único periodo.*weight null.*todas las unidades/s);
  });

  it("pide un tema por unidad temática cuando el documento las agrupa", () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/un tema por unidad temática/);
  });

  it("la última regla sigue siendo responder solo con el JSON", () => {
    const rules = EXTRACTION_SYSTEM_PROMPT.split("\n").filter((line) => /^\d+\. /.test(line));
    expect(rules.at(-1)).toMatch(/^11\. Responde únicamente con el JSON/);
  });
});
