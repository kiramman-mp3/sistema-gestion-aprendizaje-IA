import { BadRequestException } from "@nestjs/common";
import type { ProposalItemInput } from "./proposal.dto";
import { normalizeItems } from "./proposal-structure";

const SECTION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_SECTION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

const section = (overrides: Partial<ProposalItemInput> = {}): ProposalItemInput => ({
  id: SECTION_ID,
  itemType: "SECTION",
  title: "Unidad 1",
  ...overrides,
});
const activity = (overrides: Partial<ProposalItemInput> = {}): ProposalItemInput => ({
  itemType: "ASSIGN",
  title: "Tarea 1",
  parentId: SECTION_ID,
  ...overrides,
});

function problemsOf(inputs: ProposalItemInput[]) {
  try {
    normalizeItems(inputs, newId);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (
      (error as BadRequestException).getResponse() as {
        details: { path: string; message: string }[];
      }
    ).details;
  }
  throw new Error("Se esperaba un 400");
}

describe("normalizeItems", () => {
  it("asigna posiciones por el orden del arreglo y ids a los elementos nuevos", () => {
    const items = normalizeItems([section(), activity(), activity({ title: "Tarea 2" })], newId);

    expect(items.map((item) => item.position)).toEqual([0, 1, 2]);
    expect(items[0]!.id).toBe(SECTION_ID);
    expect(items[1]!.id).toMatch(/^00000000-0000-4000-8000-/);
    expect(items[1]!.parentId).toBe(SECTION_ID);
  });

  it("aplica valores por defecto sin inventar fechas ni ponderaciones", () => {
    const [, child] = normalizeItems([section(), activity()], newId);

    expect(child).toMatchObject({
      description: null,
      learningOutcomeIds: [],
      dueDate: null,
      weight: null,
    });
  });

  it("la actividad hereda la unitRef de su sección", () => {
    const [, child] = normalizeItems(
      [section({ unitRef: "gradingPeriods[1].units[0]" }), activity()],
      newId,
    );

    expect(child!.unitRef).toBe("gradingPeriods[1].units[0]");
  });

  it("una sección nueva sin unitRef recibe una propia, que no cuenta como periodo", () => {
    const [created] = normalizeItems([section()], newId);

    expect(created!.unitRef).toBe(`custom:${SECTION_ID}`);
  });

  it("conserva la unitRef que ya tenía un elemento guardado", () => {
    const known = new Map([[SECTION_ID, "gradingPeriods[0].units[2]"]]);

    const [kept] = normalizeItems([section()], newId, known);

    expect(kept!.unitRef).toBe("gradingPeriods[0].units[2]");
  });

  it("quita resultados de aprendizaje repetidos", () => {
    const [, child] = normalizeItems(
      [section(), activity({ learningOutcomeIds: ["RA1", "RA1", "RA2"] })],
      newId,
    );

    expect(child!.learningOutcomeIds).toEqual(["RA1", "RA2"]);
  });

  it("acepta una propuesta sin elementos", () => {
    expect(normalizeItems([], newId)).toEqual([]);
  });

  describe("estructura inválida", () => {
    it("una sección no puede tener padre", () => {
      expect(
        problemsOf([section(), section({ id: OTHER_SECTION_ID, parentId: SECTION_ID })]),
      ).toEqual([{ path: "items.1.parentId", message: "Una sección no puede tener padre." }]);
    });

    it("una actividad debe tener padre", () => {
      expect(problemsOf([section(), activity({ parentId: null })])).toEqual([
        { path: "items.1.parentId", message: "Una actividad debe estar dentro de una sección." },
      ]);
    });

    it("el padre de una actividad debe ser una sección de la propuesta", () => {
      const tarea = {
        id: OTHER_SECTION_ID,
        itemType: "ASSIGN" as const,
        title: "x",
        parentId: SECTION_ID,
      };

      expect(problemsOf([section(), tarea, activity({ parentId: OTHER_SECTION_ID })])).toEqual([
        { path: "items.2.parentId", message: "El padre debe ser una sección de esta propuesta." },
      ]);
      expect(problemsOf([activity({ parentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" })])).toEqual([
        { path: "items.0.parentId", message: "El padre debe ser una sección de esta propuesta." },
      ]);
    });

    it("los ids no se repiten", () => {
      expect(problemsOf([section(), section()])).toEqual([
        { path: "items.1.id", message: "El id está repetido." },
      ]);
    });

    it("informa todos los problemas juntos", () => {
      expect(
        problemsOf([activity({ parentId: null }), section({ parentId: SECTION_ID })]),
      ).toHaveLength(2);
    });
  });
});
