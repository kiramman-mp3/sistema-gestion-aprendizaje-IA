import { describe, expect, it } from "vitest";
import {
  findConsistencyIssues as contractIssues,
  syllabusExtractionSchema,
} from "@smart-lms/contracts";
import { buildSyllabusExtraction } from "../../../packages/contracts/src/syllabus/fixtures.ts";
import {
  addItem,
  editField,
  findConsistencyIssues,
  findFieldErrors,
  findSources,
  findUncertain,
  formatPath,
  getAt,
  markReviewed,
  newActivity,
  newGradingPeriod,
  newLearningOutcome,
  newUnit,
  parseDate,
  parsePath,
  parseWeight,
  removeItem,
  setAt,
  summarize,
} from "../../../moodle/local/ai_assistant/amd/src/extraction_model.js";

const sample = () => buildSyllabusExtraction();

describe("rutas", () => {
  it("separa claves e índices y vuelve a armar la ruta", () => {
    const path = "gradingPeriods[1].units[0].title";
    expect(parsePath(path)).toEqual(["gradingPeriods", 1, "units", 0, "title"]);
    expect(formatPath(parsePath(path))).toBe(path);
  });

  it("lee y escribe sin modificar el original", () => {
    const original = sample();
    const changed = setAt(original, "gradingPeriods[0].units[0].title", "Nuevo título");

    expect(getAt(changed, "gradingPeriods[0].units[0].title")).toBe("Nuevo título");
    expect(getAt(original, "gradingPeriods[0].units[0].title")).toBe("Requisitos");
    expect(getAt(original, "gradingPeriods[7].units")).toBeUndefined();
  });
});

describe("agregar y quitar elementos", () => {
  it("agrega elementos vacíos que siguen el esquema", () => {
    let extraction = sample();
    extraction = addItem(extraction, "learningOutcomes", newLearningOutcome(extraction));
    extraction = addItem(extraction, "gradingPeriods", newGradingPeriod());
    extraction = addItem(extraction, "gradingPeriods[2].units", newUnit());
    extraction = addItem(extraction, "gradingPeriods[2].units[0].activities", newActivity());

    expect(extraction.learningOutcomes.at(-1).id).toBe("RA3");
    expect(extraction.gradingPeriods[2].units[0].activities[0].requiresTeacherReview).toBe(true);
  });

  it("elige un id libre para el nuevo resultado de aprendizaje", () => {
    const extraction = sample();
    extraction.learningOutcomes = [{ id: "RA3", description: "x" }];

    expect(newLearningOutcome(extraction).id).toBe("RA2");
    extraction.learningOutcomes.push({ id: "RA2", description: "y" });
    expect(newLearningOutcome(extraction).id).toBe("RA4");
  });

  it("al quitar un elemento descarta sus notas y recorre los índices siguientes", () => {
    let extraction = sample();
    extraction = addItem(extraction, "gradingPeriods[1].units[0].activities", newActivity());
    extraction.uncertainFields.push(
      { path: "gradingPeriods[1].units[0].activities[1].weight", reason: "missing", note: null },
      { path: "learningOutcomes[1].description", reason: "ambiguous", note: null },
    );
    extraction.sourceReferences.push({ path: "learningOutcomes[1]", page: 3, excerpt: null });

    const result = removeItem(extraction, "gradingPeriods[1].units[0].activities", 0);

    expect(result.gradingPeriods[1].units[0].activities).toHaveLength(1);
    // La nota de la actividad 0 se va; la de la actividad 1 pasa a ser la 0.
    expect(result.uncertainFields.map((field) => field.path)).toEqual([
      "gradingPeriods[1].units[0].activities[0].weight",
      "learningOutcomes[1].description",
    ]);

    const outcomes = removeItem(extraction, "learningOutcomes", 0);
    expect(outcomes.sourceReferences).toEqual([
      { path: "learningOutcomes[0]", page: 3, excerpt: null },
    ]);
    expect(outcomes.uncertainFields.at(-1).path).toBe("learningOutcomes[0].description");
  });
});

describe("revisión", () => {
  it("marca como revisado el campo editado y solo ese", () => {
    const path = "gradingPeriods[1].units[0].activities[0].suggestedDueDate";
    const extraction = sample();
    expect(findUncertain(extraction, path)).toMatchObject({ reason: "missing" });

    const edited = editField(extraction, path, "2027-01-15");

    expect(getAt(edited, path)).toBe("2027-01-15");
    expect(findUncertain(edited, path)).toBeUndefined();
    expect(extraction.uncertainFields).toHaveLength(1);
  });

  it("marcar como revisado no cambia el valor", () => {
    const path = "gradingPeriods[1].units[0].activities[0].suggestedDueDate";
    const reviewed = markReviewed(sample(), path);

    expect(reviewed.uncertainFields).toEqual([]);
    expect(getAt(reviewed, path)).toBeNull();
  });

  it("devuelve las fuentes del elemento que contiene el campo", () => {
    const extraction = sample();

    expect(findSources(extraction, "learningOutcomes[0].description")).toHaveLength(1);
    expect(findSources(extraction, "learningOutcomes[1].description")).toHaveLength(0);
  });
});

describe("lectura de campos de texto", () => {
  it("interpreta ponderaciones, fechas y vacíos", () => {
    expect(parseWeight(" 12,5 ")).toBe(12.5);
    expect(parseWeight("")).toBeNull();
    expect(parseWeight("abc")).toBeNaN();
    expect(parseDate("")).toBeNull();
    expect(parseDate(" 2026-11-16 ")).toBe("2026-11-16");
  });
});

describe("errores de campo", () => {
  it("no reporta errores en una extracción válida", () => {
    expect(findFieldErrors(sample())).toEqual([]);
  });

  it("detecta lo que el esquema del backend rechazaría", () => {
    const extraction = sample();
    extraction.course.name = "  ";
    extraction.learningOutcomes[0].id = "R A1";
    extraction.gradingPeriods[0].weight = 120;
    extraction.gradingPeriods[0].units[0].startDate = "2026-13-40";
    extraction.gradingPeriods[0].units[0].activities[0].weight = Number.NaN;
    extraction.bibliography = [""];

    expect(findFieldErrors(extraction)).toEqual(
      expect.arrayContaining([
        { code: "required", path: "course.name" },
        { code: "outcomeid", path: "learningOutcomes[0].id" },
        { code: "weight", path: "gradingPeriods[0].weight" },
        { code: "date", path: "gradingPeriods[0].units[0].startDate" },
        { code: "weight", path: "gradingPeriods[0].units[0].activities[0].weight" },
        { code: "required", path: "bibliography[0]" },
      ]),
    );
  });

  it("una extracción sin errores de campo cumple el esquema de los contratos", () => {
    const extraction = sample();
    expect(findFieldErrors(extraction)).toEqual([]);
    expect(syllabusExtractionSchema.safeParse(extraction).success).toBe(true);
  });

  it("los elementos nuevos vacíos no se pueden guardar hasta completarlos", () => {
    const extraction = addItem(sample(), "gradingPeriods", newGradingPeriod());

    expect(summarize(extraction).canSave).toBe(false);
  });
});

describe("coherencia: mismo resultado que el backend", () => {
  const variants = {
    "extracción coherente": () => {},
    "resultado repetido": (s) => s.learningOutcomes.push({ id: "RA1", description: "Duplicado" }),
    "resultado inexistente": (s) => {
      s.gradingPeriods[0].units[0].activities[0].learningOutcomeIds = ["RA9"];
      s.gradingPeriods[1].units[0].learningOutcomeIds = ["RA8"];
    },
    "actividad sin resultado": (s) => {
      s.gradingPeriods[0].units[0].learningOutcomeIds = [];
      s.gradingPeriods[0].units[0].activities[0].learningOutcomeIds = [];
    },
    "periodos que no suman 100": (s) => (s.gradingPeriods[0].weight = 70),
    "periodo sin ponderación": (s) => (s.gradingPeriods[0].weight = null),
    "actividades que superan 100": (s) => {
      s.gradingPeriods[0].units[0].activities[0].weight = 80;
      s.gradingPeriods[0].units[0].activities.push({ ...newActivity(), title: "Otra", weight: 40 });
    },
    "unidad con fechas invertidas": (s) => (s.gradingPeriods[0].units[0].endDate = "2026-11-01"),
    "entrega fuera de la unidad": (s) =>
      (s.gradingPeriods[0].units[0].activities[0].suggestedDueDate = "2027-02-01"),
    "varios problemas a la vez": (s) => {
      s.learningOutcomes.push({ id: "RA2", description: "Duplicado" });
      s.gradingPeriods[1].weight = 10;
      s.gradingPeriods[0].units[0].startDate = "2026-12-20";
    },
  };

  for (const [name, mutate] of Object.entries(variants)) {
    it(name, () => {
      const extraction = sample();
      mutate(extraction);
      const key = (issue) => `${issue.code} ${issue.path}`;

      expect(findConsistencyIssues(extraction).map(key).sort()).toEqual(
        contractIssues(extraction).map(key).sort(),
      );
    });
  }

  it("entrega los datos para el mensaje localizado", () => {
    const extraction = sample();
    extraction.gradingPeriods[0].weight = 70;

    expect(findConsistencyIssues(extraction)).toEqual([
      { code: "GRADING_PERIOD_WEIGHTS_NOT_100", path: "gradingPeriods", params: { total: 120 } },
    ]);
  });
});

describe("resumen", () => {
  it("cuenta lo que falta por revisar", () => {
    expect(summarize(sample())).toEqual({
      uncertain: 1,
      inconsistencies: 0,
      errors: 0,
      canSave: true,
    });
  });

  it("las advertencias de coherencia no impiden guardar", () => {
    const extraction = sample();
    extraction.gradingPeriods[0].weight = 70;

    expect(summarize(extraction)).toMatchObject({ inconsistencies: 1, canSave: true });
  });
});
