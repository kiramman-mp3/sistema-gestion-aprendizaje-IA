import { describe, expect, it } from "vitest";
import {
  activitiesOf,
  addActivity,
  addSection,
  availableActions,
  canMove,
  findFieldErrors,
  generalIssues,
  issuesForItem,
  moveItem,
  orderedItems,
  outcomeOptions,
  removeItem,
  renumber,
  sectionsOf,
  toPatchBody,
  updateItem,
} from "../../../moodle/local/ai_assistant/amd/src/proposal_model.js";

const item = (id, itemType, parentId, position, extra = {}) => ({
  id,
  parentId,
  itemType,
  title: id,
  description: null,
  position,
  unitRef: parentId ? `unit-${parentId}` : `unit-${id}`,
  learningOutcomeIds: [],
  dueDate: null,
  weight: null,
  moodleItemId: null,
  publishStatus: "PENDING",
  ...extra,
});

/** s1 (a1, a2) y s2 (a3), como las devuelve la API. */
const sample = () => [
  item("s1", "SECTION", null, 0),
  item("a1", "ASSIGN", "s1", 1),
  item("a2", "FORUM", "s1", 2),
  item("s2", "SECTION", null, 3),
  item("a3", "QUIZ", "s2", 4),
];
const ids = (items) => orderedItems(items).map((i) => i.id);

describe("árbol", () => {
  it("ordena secciones y actividades por posición", () => {
    const shuffled = [...sample()].reverse();

    expect(sectionsOf(shuffled).map((i) => i.id)).toEqual(["s1", "s2"]);
    expect(activitiesOf(shuffled, "s1").map((i) => i.id)).toEqual(["a1", "a2"]);
    expect(ids(shuffled)).toEqual(["s1", "a1", "a2", "s2", "a3"]);
  });

  it("renumber deja las posiciones consecutivas en el orden mostrado", () => {
    const gaps = sample().map((i) => ({ ...i, position: i.position * 10 }));

    expect(renumber(gaps).map((i) => i.position)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("ediciones", () => {
  it("updateItem cambia solo ese elemento y no modifica el original", () => {
    const original = sample();

    const changed = updateItem(original, "a1", { title: "Nueva", weight: 20 });

    expect(changed.find((i) => i.id === "a1")).toMatchObject({ title: "Nueva", weight: 20 });
    expect(changed.find((i) => i.id === "a2").title).toBe("a2");
    expect(original.find((i) => i.id === "a1").title).toBe("a1");
  });

  it("addSection agrega una sección vacía al final, sin inventar fechas ni ponderaciones", () => {
    const items = addSection(sample(), "nueva");

    expect(ids(items).at(-1)).toBe("nueva");
    expect(items.find((i) => i.id === "nueva")).toMatchObject({
      itemType: "SECTION",
      parentId: null,
      title: "",
      dueDate: null,
      weight: null,
      unitRef: "custom:nueva",
    });
  });

  it("addActivity agrega al final de su sección y hereda su unitRef", () => {
    const items = addActivity(sample(), "s1", "nueva");

    expect(ids(items)).toEqual(["s1", "a1", "a2", "nueva", "s2", "a3"]);
    expect(items.find((i) => i.id === "nueva")).toMatchObject({
      itemType: "ASSIGN",
      parentId: "s1",
      unitRef: "unit-s1",
      weight: null,
      dueDate: null,
    });
    expect(orderedItems(items).map((i) => i.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("addActivity funciona en una sección sin actividades", () => {
    const items = addActivity(addSection([], "s"), "s", "a");

    expect(ids(items)).toEqual(["s", "a"]);
  });

  it("quitar una actividad deja las demás; quitar una sección quita sus actividades", () => {
    expect(ids(removeItem(sample(), "a1"))).toEqual(["s1", "a2", "s2", "a3"]);
    expect(ids(removeItem(sample(), "s1"))).toEqual(["s2", "a3"]);
    expect(orderedItems(removeItem(sample(), "s1")).map((i) => i.position)).toEqual([0, 1]);
  });
});

describe("mover", () => {
  it("sube y baja actividades dentro de su sección", () => {
    expect(ids(moveItem(sample(), "a2", -1))).toEqual(["s1", "a2", "a1", "s2", "a3"]);
    expect(ids(moveItem(sample(), "a1", 1))).toEqual(["s1", "a2", "a1", "s2", "a3"]);
  });

  it("sube y baja secciones junto con sus actividades", () => {
    expect(ids(moveItem(sample(), "s2", -1))).toEqual(["s2", "a3", "s1", "a1", "a2"]);
  });

  it("no mueve una actividad a otra sección ni fuera de los extremos", () => {
    const items = sample();

    expect(moveItem(items, "a2", 1)).toBe(items);
    expect(moveItem(items, "a1", -1)).toBe(items);
    expect(moveItem(items, "s1", -1)).toBe(items);
    expect(canMove(items, "a2", -1)).toBe(true);
    expect(canMove(items, "a2", 1)).toBe(false);
  });
});

describe("errores de campo", () => {
  it("no hay errores en una propuesta válida", () => {
    expect(findFieldErrors(sample())).toEqual([]);
  });

  it("detecta lo que el backend rechazaría con 400", () => {
    const items = updateItem(
      updateItem(updateItem(sample(), "a1", { weight: 150 }), "a2", { dueDate: "2026-13-45" }),
      "s1",
      { title: "x".repeat(256) },
    );

    expect(findFieldErrors(items)).toEqual(
      expect.arrayContaining([
        { id: "a1", field: "weight", code: "weight" },
        { id: "a2", field: "dueDate", code: "date" },
        { id: "s1", field: "title", code: "toolong" },
      ]),
    );
  });

  it("permite un título vacío: solo se marca al aprobar", () => {
    expect(findFieldErrors(updateItem(sample(), "a1", { title: "" }))).toEqual([]);
  });

  it("NaN y números fuera de rango son inválidos; 0 y 100 no", () => {
    expect(findFieldErrors(updateItem(sample(), "a1", { weight: Number.NaN }))).toHaveLength(1);
    expect(findFieldErrors(updateItem(sample(), "a1", { weight: -1 }))).toHaveLength(1);
    expect(findFieldErrors(updateItem(sample(), "a1", { weight: 0 }))).toEqual([]);
    expect(findFieldErrors(updateItem(sample(), "a1", { weight: 100 }))).toEqual([]);
  });
});

describe("cuerpo del PATCH", () => {
  it("envía solo lo que el backend acepta, en el orden mostrado", () => {
    const items = moveItem(
      updateItem(sample(), "a1", { title: "  Tarea  ", weight: 30, learningOutcomeIds: ["RA1"] }),
      "a2",
      -1,
    );

    const { items: body } = toPatchBody(items);

    expect(body.map((i) => i.id)).toEqual(["s1", "a2", "a1", "s2", "a3"]);
    expect(body[2]).toEqual({
      id: "a1",
      parentId: "s1",
      itemType: "ASSIGN",
      title: "Tarea",
      description: null,
      unitRef: "unit-s1",
      learningOutcomeIds: ["RA1"],
      dueDate: null,
      weight: 30,
    });
    for (const sent of body) {
      expect(sent).not.toHaveProperty("moodleItemId");
      expect(sent).not.toHaveProperty("publishStatus");
      expect(sent).not.toHaveProperty("position");
    }
  });
});

describe("revisión", () => {
  const issues = [
    { code: "ACTIVITY_WITHOUT_OUTCOME", severity: "warning", itemId: "a1", message: "x" },
    { code: "PERIOD_WEIGHTS_EXCEED_TOTAL", severity: "error", itemId: null, message: "y" },
  ];

  it("separa los hallazgos de un elemento de los generales", () => {
    expect(issuesForItem(issues, "a1")).toHaveLength(1);
    expect(issuesForItem(issues, "a2")).toEqual([]);
    expect(generalIssues(issues)).toEqual([issues[1]]);
  });

  it("junta los resultados de aprendizaje conocidos y los usados", () => {
    const items = updateItem(sample(), "a1", { learningOutcomeIds: ["RA9", "RA1"] });

    expect(outcomeOptions(items, ["RA1", "RA2"])).toEqual(["RA1", "RA2", "RA9"]);
    expect(outcomeOptions(sample())).toEqual([]);
  });
});

describe("acciones disponibles", () => {
  const proposal = (status, found = []) => ({ status, issues: found });

  it("se puede aprobar una propuesta guardada, en revisión y sin errores", () => {
    expect(availableActions(proposal("NEEDS_REVIEW"), false, sample())).toEqual({
      canEdit: true,
      canSave: false,
      canApprove: true,
    });
  });

  it("con cambios sin guardar se puede guardar pero no aprobar", () => {
    expect(availableActions(proposal("NEEDS_REVIEW"), true, sample())).toEqual({
      canEdit: true,
      canSave: true,
      canApprove: false,
    });
  });

  it("los errores del backend impiden aprobar; las advertencias no", () => {
    const error = { severity: "error" };
    const warning = { severity: "warning" };

    expect(availableActions(proposal("NEEDS_REVIEW", [error]), false, sample()).canApprove).toBe(
      false,
    );
    expect(availableActions(proposal("NEEDS_REVIEW", [warning]), false, sample()).canApprove).toBe(
      true,
    );
  });

  it("no se puede guardar con valores inválidos", () => {
    const invalid = updateItem(sample(), "a1", { weight: 500 });

    expect(availableActions(proposal("NEEDS_REVIEW"), true, invalid).canSave).toBe(false);
  });

  it("una propuesta aprobada se puede editar pero no volver a aprobar", () => {
    expect(availableActions(proposal("APPROVED"), false, sample())).toMatchObject({
      canEdit: true,
      canApprove: false,
    });
  });

  it.each(["PUBLISHING", "PUBLISHED", "REJECTED", "FAILED"])(
    "una propuesta %s no se puede editar",
    (status) => {
      expect(availableActions(proposal(status), true, sample())).toEqual({
        canEdit: false,
        canSave: false,
        canApprove: false,
      });
    },
  );
});
