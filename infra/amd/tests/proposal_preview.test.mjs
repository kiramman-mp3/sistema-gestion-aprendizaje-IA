// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backend } from "./stubs/assistant.mjs";
import {
  generate,
  init,
  open,
} from "../../../moodle/local/ai_assistant/amd/src/proposal_preview.js";

const PROPOSAL_ID = "11111111-1111-4111-8111-111111111111";
const SYLLABUS_ID = "22222222-2222-4222-8222-222222222222";

const item = (id, itemType, parentId, position, extra = {}) => ({
  id,
  parentId,
  itemType,
  title: id,
  description: null,
  position,
  unitRef: "gradingPeriods[0].units[0]",
  learningOutcomeIds: ["RA1"],
  dueDate: null,
  weight: null,
  moodleItemId: null,
  publishStatus: "PENDING",
  ...extra,
});

/** Propuesta como la devuelve la API: dos secciones, tres actividades. */
const proposal = (overrides = {}) => ({
  id: PROPOSAL_ID,
  courseId: 7,
  syllabusId: SYLLABUS_ID,
  extractionVersion: 2,
  status: "NEEDS_REVIEW",
  approvedBy: null,
  approvedAt: null,
  items: [
    item("s1", "SECTION", null, 0, { title: "Requisitos", description: "• Elicitación" }),
    item("a1", "ASSIGN", "s1", 1, { title: "Especificación", weight: 30, dueDate: "2026-12-04" }),
    item("a2", "FORUM", "s1", 2, { title: "Foro de dudas" }),
    item("s2", "SECTION", null, 3, { title: "Arquitectura" }),
    item("a3", "QUIZ", "s2", 4, { title: "Quiz", learningOutcomeIds: [] }),
  ],
  issues: [
    {
      code: "ACTIVITY_WITHOUT_OUTCOME",
      severity: "warning",
      itemId: "a3",
      message: '"Quiz" no está vinculada a un resultado de aprendizaje.',
    },
    {
      code: "PERIOD_WEIGHTS_NOT_TOTAL",
      severity: "warning",
      itemId: null,
      message: "Las ponderaciones del periodo 1 suman 30 en lugar de 100.",
    },
  ],
  ...overrides,
});

const root = () => document.querySelector('[data-region="proposal-preview"]');
const text = () => root().textContent;
const buttons = (label) =>
  [...root().querySelectorAll("button")].filter((b) => b.textContent.includes(label));
const button = (label) => buttons(label)[0];
/** Los botones de mover solo tienen una flecha como texto: se buscan por su nombre accesible. */
const moveButton = (label) => root().querySelector(`[aria-label="${label}"]`);
const labelled = (label) =>
  [...root().querySelectorAll("label")]
    .filter((l) => l.textContent.trim() === label)
    .map((l) => document.getElementById(l.htmlFor));
const typeInto = (node, value) => {
  node.value = value;
  node.dispatchEvent(new Event("input", { bubbles: true }));
};
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true }));

/**
 * Backend simulado: `routes` responde por "MÉTODO ruta"; PATCH y approve devuelven la propuesta con los
 * cambios que el backend real aplicaría.
 */
const serve = (state = proposal(), routes = {}) => {
  backend.calls = [];
  backend.handler = async (call) => {
    const key = `${call.method} ${call.path}`;
    if (routes[key]) return routes[key](call);
    if (key === `GET /proposals/${PROPOSAL_ID}`) return structuredClone(state);
    if (call.path.startsWith(`/syllabi/${SYLLABUS_ID}/extraction`)) {
      return { version: 2, content: { learningOutcomes: [{ id: "RA1" }, { id: "RA2" }] } };
    }
    if (key === `PATCH /proposals/${PROPOSAL_ID}`) {
      return {
        ...state,
        items: call.json.items.map((i, position) => ({
          ...i,
          position,
          moodleItemId: null,
          publishStatus: "PENDING",
        })),
      };
    }
    if (key === `POST /proposals/${PROPOSAL_ID}/approve`) {
      return { ...state, status: "APPROVED", approvedBy: 42, approvedAt: "2026-11-09T15:00:00Z" };
    }
    throw Object.assign(new Error(`Ruta sin respuesta: ${key}`), { code: "NOT_FOUND" });
  };
};

beforeEach(() => {
  document.body.innerHTML = `
    <div data-region="local_ai_assistant">
      <section class="d-none" data-region="proposal-preview"></section>
    </div>`;
});

describe("carga", () => {
  it("muestra el estado, las secciones y las actividades de la propuesta", async () => {
    serve();

    await open(7, PROPOSAL_ID);

    expect(backend.calls[0]).toMatchObject({ method: "GET", path: `/proposals/${PROPOSAL_ID}` });
    expect(root().classList.contains("d-none")).toBe(false);
    expect(text()).toContain("Course proposal");
    expect(text()).toContain("Needs review");
    expect(text()).toContain("Based on version 2 of the extracted structure.");
    expect(text()).toContain("Section 1: Requisitos");
    expect(text()).toContain("Activity 2: Foro de dudas");
    expect(text()).toContain("Section 2: Arquitectura");
    expect(labelled("Title").map((input) => input.value)).toEqual([
      "Requisitos",
      "Especificación",
      "Foro de dudas",
      "Arquitectura",
      "Quiz",
    ]);
  });

  it("muestra las observaciones del backend, las del elemento y las generales", async () => {
    serve();

    await open(7, PROPOSAL_ID);

    expect(text()).toContain("2 warnings to review");
    expect(text()).toContain("Las ponderaciones del periodo 1 suman 30 en lugar de 100.");
    expect(text()).toContain('"Quiz" no está vinculada a un resultado de aprendizaje.');
  });

  it("ofrece los resultados de aprendizaje de la extracción", async () => {
    serve();

    await open(7, PROPOSAL_ID);

    const boxes = [...root().querySelectorAll('input[type="checkbox"]')].map(
      (box) => box.nextElementSibling.textContent,
    );
    expect(boxes).toContain("RA2");
    expect(
      backend.calls.some((call) => call.path === `/syllabi/${SYLLABUS_ID}/extraction?version=2`),
    ).toBe(true);
  });

  it("si no puede leer la extracción, usa los resultados que ya están en la propuesta", async () => {
    serve(proposal(), {
      [`GET /syllabi/${SYLLABUS_ID}/extraction?version=2`]: async () => {
        throw Object.assign(new Error("no"), { code: "NOT_FOUND" });
      },
    });

    await open(7, PROPOSAL_ID);

    // Solo las casillas de resultados de aprendizaje: la de «Aprobar y publicar» no cuenta.
    const boxes = [...root().querySelectorAll('fieldset input[type="checkbox"]')].map(
      (box) => box.nextElementSibling.textContent,
    );
    expect(new Set(boxes)).toEqual(new Set(["RA1"]));
  });

  it("muestra el error si la propuesta no carga", async () => {
    serve(proposal(), {
      [`GET /proposals/${PROPOSAL_ID}`]: async () => {
        throw Object.assign(new Error("no"), { code: "PROPOSAL_NOT_FOUND" });
      },
    });

    await open(7, PROPOSAL_ID);

    expect(root().querySelector('[role="alert"]').textContent).toBe(
      "The proposal could not be loaded (PROPOSAL_NOT_FOUND).",
    );
  });
});

describe("edición y guardado", () => {
  it("al editar se habilita guardar y se bloquea aprobar hasta guardar", async () => {
    serve();
    await open(7, PROPOSAL_ID);
    expect(button("Save changes").disabled).toBe(true);
    expect(button("Approve the proposal").disabled).toBe(false);

    typeInto(labelled("Title")[1], "Especificación de requisitos");

    expect(button("Save changes").disabled).toBe(false);
    expect(button("Approve the proposal").disabled).toBe(true);
    expect(text()).toContain("Unsaved changes. Save to refresh the review.");
  });

  it("guarda con PATCH solo con lo que el backend acepta y vuelve a cargar la respuesta", async () => {
    serve();
    await open(7, PROPOSAL_ID);
    typeInto(labelled("Title")[1], "Especificación de requisitos");
    typeInto(labelled("Weight (%)")[0], "40");

    click(button("Save changes"));
    await vi.waitFor(() => expect(text()).toContain("Changes saved."));

    const patch = backend.calls.find((call) => call.method === "PATCH");
    expect(patch.json.items.map((i) => i.id)).toEqual(["s1", "a1", "a2", "s2", "a3"]);
    expect(patch.json.items[1]).toEqual({
      id: "a1",
      parentId: "s1",
      itemType: "ASSIGN",
      title: "Especificación de requisitos",
      description: null,
      unitRef: "gradingPeriods[0].units[0]",
      learningOutcomeIds: ["RA1"],
      dueDate: "2026-12-04",
      weight: 40,
    });
    expect(patch.json.items[1]).not.toHaveProperty("publishStatus");
    expect(button("Save changes").disabled).toBe(true);
  });

  it("un valor vacío se guarda como null, no como cadena vacía", async () => {
    serve();
    await open(7, PROPOSAL_ID);
    typeInto(labelled("Weight (%)")[0], "");
    typeInto(labelled("Due date")[0], "");
    typeInto(root().querySelector("textarea"), "   ");

    click(button("Save changes"));
    await vi.waitFor(() =>
      expect(backend.calls.some((call) => call.method === "PATCH")).toBe(true),
    );

    const sent = backend.calls.find((call) => call.method === "PATCH").json.items;
    expect(sent[1]).toMatchObject({ weight: null, dueDate: null });
    expect(sent[0].description).toBeNull();
  });

  it("resalta un valor inválido y no deja guardar", async () => {
    serve();
    await open(7, PROPOSAL_ID);

    typeInto(labelled("Weight (%)")[0], "150");

    expect(labelled("Weight (%)")[0].classList.contains("is-invalid")).toBe(true);
    expect(text()).toContain("Enter a number between 0 and 100.");
    expect(button("Save changes").disabled).toBe(true);

    typeInto(labelled("Weight (%)")[0], "50");

    expect(button("Save changes").disabled).toBe(false);
  });

  it("muestra el error del backend al guardar y conserva los cambios", async () => {
    serve(proposal(), {
      [`PATCH /proposals/${PROPOSAL_ID}`]: async () => {
        throw Object.assign(new Error("x"), { code: "VALIDATION_ERROR" });
      },
    });
    await open(7, PROPOSAL_ID);
    typeInto(labelled("Title")[1], "Otro título");

    click(button("Save changes"));
    await vi.waitFor(() => expect(root().querySelector('[role="alert"]')).not.toBeNull());

    expect(root().querySelector('[role="alert"]').textContent).toBe(
      "The changes could not be saved (VALIDATION_ERROR).",
    );
    expect(labelled("Title")[1].value).toBe("Otro título");
    expect(button("Save changes").disabled).toBe(false);
  });

  it("cambia el tipo de elemento y los resultados de aprendizaje de una actividad", async () => {
    serve();
    await open(7, PROPOSAL_ID);
    const select = root().querySelector("select");
    select.value = "FORUM";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const ra2 = [...root().querySelectorAll('input[type="checkbox"]')].find(
      (box) => box.nextElementSibling.textContent === "RA2",
    );
    ra2.checked = true;
    ra2.dispatchEvent(new Event("change", { bubbles: true }));

    click(button("Save changes"));
    await vi.waitFor(() =>
      expect(backend.calls.some((call) => call.method === "PATCH")).toBe(true),
    );

    const first = backend.calls.find((call) => call.method === "PATCH").json.items[1];
    expect(first.itemType).toBe("FORUM");
  });
});

describe("estructura", () => {
  it("agrega una actividad al final de su sección y una sección nueva", async () => {
    serve();
    await open(7, PROPOSAL_ID);

    click(buttons("Add activity")[0]);
    click(button("Add section"));
    click(button("Save changes"));
    await vi.waitFor(() =>
      expect(backend.calls.some((call) => call.method === "PATCH")).toBe(true),
    );

    const sent = backend.calls.find((call) => call.method === "PATCH").json.items;
    expect(sent.map((i) => [i.itemType, i.parentId ? "hija" : "raíz"])).toEqual([
      ["SECTION", "raíz"],
      ["ASSIGN", "hija"],
      ["FORUM", "hija"],
      ["ASSIGN", "hija"],
      ["SECTION", "raíz"],
      ["QUIZ", "hija"],
      ["SECTION", "raíz"],
    ]);
    expect(sent[3]).toMatchObject({ parentId: "s1", weight: null, dueDate: null, title: "" });
    expect(sent[6]).toMatchObject({ parentId: null, title: "" });
    expect(sent[3].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("quita una actividad y una sección con sus actividades", async () => {
    serve();
    await open(7, PROPOSAL_ID);

    click(button("Remove Activity 1"));
    click(button("Remove Section 2"));
    click(button("Save changes"));
    await vi.waitFor(() =>
      expect(backend.calls.some((call) => call.method === "PATCH")).toBe(true),
    );

    expect(
      backend.calls.find((call) => call.method === "PATCH").json.items.map((i) => i.id),
    ).toEqual(["s1", "a2"]);
  });

  it("sube y baja elementos, y el orden se envía", async () => {
    serve();
    await open(7, PROPOSAL_ID);

    click(moveButton("Move Activity 2 up"));
    click(moveButton("Move Section 2 up"));
    click(button("Save changes"));
    await vi.waitFor(() =>
      expect(backend.calls.some((call) => call.method === "PATCH")).toBe(true),
    );

    expect(
      backend.calls.find((call) => call.method === "PATCH").json.items.map((i) => i.id),
    ).toEqual(["s2", "a3", "s1", "a2", "a1"]);
  });

  it("no ofrece subir lo que ya está arriba", async () => {
    serve();
    await open(7, PROPOSAL_ID);

    expect(moveButton("Move Section 1 up").disabled).toBe(true);
    expect(moveButton("Move Activity 1 down").disabled).toBe(false);
    expect(moveButton("Move Activity 2 down").disabled).toBe(true);
  });
});

describe("aprobación", () => {
  it("aprueba la propuesta guardada y muestra quién y cuándo", async () => {
    serve();
    await open(7, PROPOSAL_ID);

    click(button("Approve the proposal"));
    await vi.waitFor(() => expect(text()).toContain("Approved by user 42"));

    expect(
      backend.calls.some(
        (call) => call.method === "POST" && call.path === `/proposals/${PROPOSAL_ID}/approve`,
      ),
    ).toBe(true);
    expect(text()).toContain("If you edit it, it returns to review.");
    expect(button("Approve the proposal")?.classList.contains("d-none")).toBe(true);
  });

  it("no deja aprobar si el backend reporta errores", async () => {
    const withError = proposal({
      issues: [
        {
          code: "PERIOD_WEIGHTS_EXCEED_TOTAL",
          severity: "error",
          itemId: null,
          message: "Las ponderaciones suman 120.",
        },
      ],
    });
    serve(withError);

    await open(7, PROPOSAL_ID);

    expect(text()).toContain("1 errors to fix before approving");
    expect(button("Approve the proposal").disabled).toBe(true);
    expect(text()).toContain("Save your changes and fix the errors to approve.");
  });

  it("muestra el error si la aprobación falla", async () => {
    serve(proposal(), {
      [`POST /proposals/${PROPOSAL_ID}/approve`]: async () => {
        throw Object.assign(new Error("x"), { code: "INVALID_TRANSITION" });
      },
    });
    await open(7, PROPOSAL_ID);

    click(button("Approve the proposal"));
    await vi.waitFor(() => expect(root().querySelector('[role="alert"]')).not.toBeNull());

    expect(root().querySelector('[role="alert"]').textContent).toBe(
      "The proposal could not be approved (INVALID_TRANSITION).",
    );
  });

  it("una propuesta aprobada se puede editar y no ofrece aprobar de nuevo", async () => {
    serve(proposal({ status: "APPROVED", approvedBy: 42, approvedAt: "2026-11-09T15:00:00Z" }));

    await open(7, PROPOSAL_ID);

    expect(text()).toContain("Approved by user 42");
    expect(labelled("Title")[0].disabled).toBe(false);
    expect(button("Approve the proposal").classList.contains("d-none")).toBe(true);
  });

  it.each(["PUBLISHING", "PUBLISHED", "REJECTED", "FAILED"])(
    "una propuesta %s es de solo lectura",
    async (status) => {
      serve(proposal({ status }));

      await open(7, PROPOSAL_ID);

      expect(text()).toContain("This proposal can no longer be edited.");
      expect(labelled("Title").every((input) => input.disabled)).toBe(true);
      expect(buttons("Remove")).toEqual([]);
      expect(button("Save changes").classList.contains("d-none")).toBe(true);
    },
  );
});

describe("generar la propuesta", () => {
  it("la pide al backend con la versión de la extracción y la muestra", async () => {
    serve(proposal(), { "POST /proposals": async () => proposal() });

    await generate(7, SYLLABUS_ID, 2);

    const post = backend.calls.find((call) => call.method === "POST");
    expect(post.json).toEqual({ syllabusId: SYLLABUS_ID, extractionVersion: 2 });
    expect(text()).toContain("Section 1: Requisitos");
  });

  it("RF-07: si el sílabo ya tiene propuesta, avisa y deja abrirla o crear otra", async () => {
    let created = 0;
    serve(proposal(), {
      "POST /proposals": async (call) => {
        if (!call.json.confirmDuplicate) {
          throw Object.assign(new Error("x"), {
            code: "PROPOSAL_EXISTS",
            details: [{ path: "proposalId", message: PROPOSAL_ID }],
          });
        }
        created += 1;
        return proposal();
      },
    });

    await generate(7, SYLLABUS_ID, 2);

    expect(text()).toContain("This syllabus already has a proposal.");
    expect(created).toBe(0);

    click(button("Create another proposal"));
    await vi.waitFor(() => expect(text()).toContain("Section 1: Requisitos"));

    expect(created).toBe(1);
    expect(
      backend.calls.filter((call) => call.method === "POST").at(-1).json.confirmDuplicate,
    ).toBe(true);
  });

  it("abre la propuesta existente", async () => {
    serve(proposal(), {
      "POST /proposals": async () => {
        throw Object.assign(new Error("x"), {
          code: "PROPOSAL_EXISTS",
          details: [{ path: "proposalId", message: PROPOSAL_ID }],
        });
      },
    });
    await generate(7, SYLLABUS_ID, 2);

    click(button("Open the existing proposal"));
    await vi.waitFor(() => expect(text()).toContain("Section 1: Requisitos"));

    expect(backend.calls.at(-2)).toMatchObject({
      method: "GET",
      path: `/proposals/${PROPOSAL_ID}`,
    });
  });

  it("explica que hay que guardar la revisión de la extracción primero", async () => {
    serve(proposal(), {
      "POST /proposals": async () => {
        throw Object.assign(new Error("x"), { code: "EXTRACTION_NOT_REVIEWED" });
      },
    });

    await generate(7, SYLLABUS_ID, 2);

    expect(text()).toContain(
      "Save your review of the extracted structure before generating the proposal.",
    );
  });

  it("muestra otros errores con su código", async () => {
    serve(proposal(), {
      "POST /proposals": async () => {
        throw Object.assign(new Error("x"), { code: "FORBIDDEN_CAPABILITY" });
      },
    });

    await generate(7, SYLLABUS_ID, 2);

    expect(root().querySelector('[role="alert"]').textContent).toBe(
      "The proposal could not be generated (FORBIDDEN_CAPABILITY).",
    );
  });
});

describe("retomar la última propuesta al abrir la página", () => {
  it("sin id en la dirección abre la propuesta más reciente del curso", async () => {
    serve(proposal(), {
      "GET /proposals/latest": async () => proposal(),
    });

    await init(7);
    await vi.waitFor(() => expect(text()).toContain("Course proposal"));

    expect(backend.calls[0]).toMatchObject({ method: "GET", path: "/proposals/latest" });
    expect(backend.calls.some((call) => call.path === `/proposals/${PROPOSAL_ID}`)).toBe(true);
    expect(text()).toContain("Requisitos");
  });

  it("un curso sin propuestas no muestra nada y no falla", async () => {
    serve(proposal(), {
      "GET /proposals/latest": async () => {
        throw Object.assign(new Error("no"), { code: "PROPOSAL_NOT_FOUND", status: 404 });
      },
    });

    await init(7);

    expect(backend.calls.map((call) => call.path)).toEqual(["/proposals/latest"]);
    expect(root().classList.contains("d-none")).toBe(true);
  });

  it("con un id en la dirección usa ese y no pregunta por la última", async () => {
    serve(proposal());

    await init(7, PROPOSAL_ID);
    await vi.waitFor(() => expect(text()).toContain("Course proposal"));

    expect(backend.calls.some((call) => call.path === "/proposals/latest")).toBe(false);
  });
});
