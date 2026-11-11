// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSyllabusExtraction } from "../../../packages/contracts/src/syllabus/fixtures.ts";
import { backend } from "./stubs/assistant.mjs";
import { open } from "../../../moodle/local/ai_assistant/amd/src/extraction_editor.js";

const SYLLABUS_ID = "11111111-1111-4111-8111-111111111111";
const DUE_PATH = "gradingPeriods[1].units[0].activities[0].suggestedDueDate";

const version = (content, overrides = {}) => ({
  version: 1,
  schemaVersion: "1.0",
  source: "AI",
  content,
  consistencyIssues: [],
  createdAt: "2026-11-09T12:00:00Z",
  ...overrides,
});

const root = () => document.querySelector('[data-region="extraction-editor"]');
const field = (path) =>
  [...root().querySelectorAll("[data-path]")].find((node) => node.dataset.path === path);
const buttons = (text) =>
  [...root().querySelectorAll("button")].filter((b) => b.textContent.includes(text));
const type = (node, value) => {
  node.value = value;
  node.dispatchEvent(new Event("input", { bubbles: true }));
};
const change = (node, value) => {
  node.value = value;
  node.dispatchEvent(new Event("change", { bubbles: true }));
};
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true }));

/** Opens the editor with the backend answering with the given extraction. */
const mount = async (content = buildSyllabusExtraction(), saveHandler = null) => {
  backend.calls = [];
  backend.handler = async (call) => {
    if (call.method === "PUT") {
      return saveHandler
        ? saveHandler(call)
        : version(call.json, { version: 2, source: "TEACHER" });
    }
    return version(content);
  };
  await open(2, SYLLABUS_ID);
};

beforeEach(() => {
  document.body.innerHTML = `
    <div data-region="local_ai_assistant">
      <section class="d-none" data-region="extraction-editor"></section>
      <section class="d-none" data-region="proposal-preview"></section>
    </div>`;
});

describe("carga", () => {
  it("pide la última versión de la extracción y muestra el editor", async () => {
    await mount();

    expect(backend.calls[0]).toMatchObject({
      courseId: 2,
      path: `/syllabi/${SYLLABUS_ID}/extraction`,
      method: "GET",
    });
    expect(root().classList.contains("d-none")).toBe(false);
    expect(root().textContent).toContain("Review the extracted structure");
    expect(root().textContent).toContain("Version 1, proposed by the assistant");
    expect(field("course.name").value).toBe("Ingeniería de Software");
    expect(field("gradingPeriods[0].units[0].topics[1]").value).toBe("Historias de usuario");
    expect(field("gradingPeriods[0].units[0].startDate").value).toBe("2026-11-16");
    expect(field("gradingPeriods[0].units[0].activities[0].weight").value).toBe("30");
    expect(field("gradingPeriods[0].units[0].activities[0].type").value).toBe("assignment");
  });

  it("muestra el error si no se puede cargar", async () => {
    backend.calls = [];
    backend.handler = async () => {
      throw Object.assign(new Error("no"), { code: "NOT_FOUND" });
    };

    await open(2, SYLLABUS_ID);

    expect(root().querySelector('[role="alert"]').textContent).toBe(
      "The extracted structure could not be loaded (NOT_FOUND).",
    );
  });
});

describe("indicador de confianza", () => {
  it("marca el campo dudoso, su motivo y la fuente citada", async () => {
    await mount();

    const flagged = field(DUE_PATH).closest(".mb-3");
    expect(flagged.textContent).toContain("Not in the syllabus");
    expect(root().textContent).toContain("Source: page 2");
    expect(root().textContent).toContain("1 uncertain fields to review");
  });

  it("editar un campo dudoso lo da por revisado", async () => {
    await mount();

    type(field(DUE_PATH), "2027-01-15");

    expect(field(DUE_PATH).closest(".mb-3").textContent).not.toContain("Not in the syllabus");
    expect(root().textContent).toContain("Nothing left to review.");
  });

  it("se puede marcar como revisado sin cambiar el valor", async () => {
    await mount();

    click(buttons("Mark as reviewed")[0]);

    expect(root().textContent).toContain("Nothing left to review.");
    expect(field(DUE_PATH).value).toBe("");
  });

  it("muestra las notas que no corresponden a un campo visible", async () => {
    const content = buildSyllabusExtraction();
    content.uncertainFields.push({
      path: "bibliography",
      reason: "ambiguous",
      note: "Parece incompleta",
    });
    await mount(content);

    expect(root().textContent).toContain("Ambiguous: bibliography (Parece incompleta)");
  });
});

describe("validación y coherencia", () => {
  it("resalta un valor inválido y no deja guardar hasta corregirlo", async () => {
    await mount();
    const [save] = buttons("Save review");
    expect(save.disabled).toBe(false);

    type(field("gradingPeriods[0].weight"), "150");

    expect(field("gradingPeriods[0].weight").classList.contains("is-invalid")).toBe(true);
    expect(field("gradingPeriods[0].weight").closest(".mb-3").textContent).toContain(
      "Enter a number between 0 and 100.",
    );
    expect(save.disabled).toBe(true);

    type(field("gradingPeriods[0].weight"), "50");

    expect(field("gradingPeriods[0].weight").classList.contains("is-invalid")).toBe(false);
    expect(save.disabled).toBe(false);
  });

  it("un título vacío se marca como obligatorio", async () => {
    await mount();

    type(field("gradingPeriods[0].units[0].title"), "  ");

    expect(field("gradingPeriods[0].units[0].title").closest(".mb-3").textContent).toContain(
      "This field cannot be empty.",
    );
  });

  it("muestra advertencias de coherencia sin impedir guardar", async () => {
    await mount();

    type(field("gradingPeriods[0].weight"), "70");

    expect(root().textContent).toContain(
      "The weights of the grading periods add up to 120 instead of 100.",
    );
    expect(buttons("Save review")[0].disabled).toBe(false);
  });

  it("una fecha de entrega fuera de la unidad genera una advertencia", async () => {
    await mount();

    type(field("gradingPeriods[0].units[0].activities[0].suggestedDueDate"), "2027-06-01");

    expect(root().textContent).toContain(
      'The date of "Especificación de requisitos" is outside the unit\'s date range.',
    );
  });
});

describe("estructura", () => {
  it("agrega y quita una actividad, y las notas siguen a su elemento", async () => {
    await mount();
    const before = buttons("Add activity").length;

    click(buttons("Add activity")[0]);

    expect(field("gradingPeriods[0].units[0].activities[1].title")).toBeDefined();
    expect(buttons("Add activity")).toHaveLength(before);
    expect(root().textContent).toContain("1 values to fix before saving");

    click(buttons("Remove Activity 2")[0]);

    expect(field("gradingPeriods[0].units[0].activities[1]")).toBeUndefined();
    expect(root().textContent).not.toContain("values to fix before saving");
    // La nota de la actividad del segundo periodo sigue en su sitio.
    expect(field(DUE_PATH).closest(".mb-3").textContent).toContain("Not in the syllabus");
  });

  it("agrega un resultado de aprendizaje y se puede vincular a una unidad", async () => {
    await mount();

    click(buttons("Add learning outcome")[0]);
    type(field("learningOutcomes[2].description"), "Evalúa la calidad del software.");

    const links = [...root().querySelectorAll('fieldset input[type="checkbox"]')].map((box) =>
      box.closest("div").textContent.trim(),
    );
    expect(links).toContain("RA3");
  });

  it("al renombrar un resultado, las unidades siguen vinculadas", async () => {
    await mount();

    change(field("learningOutcomes[0].id"), "RA-A");

    expect(field("learningOutcomes[0].id").value).toBe("RA-A");
    expect(root().textContent).not.toContain("does not exist in the syllabus");
    const checked = [...root().querySelectorAll('fieldset input[type="checkbox"]:checked')].map(
      (box) => box.closest("div").textContent.trim(),
    );
    expect(checked).toContain("RA-A");
  });

  it("al quitar un tema, el resto se reordena", async () => {
    await mount();

    click(buttons("Remove Topic 1")[0]);

    expect(field("gradingPeriods[0].units[0].topics[0]").value).toBe("Historias de usuario");
    expect(field("gradingPeriods[0].units[0].topics[1]")).toBeUndefined();
  });
});

describe("guardado", () => {
  it("envía la extracción corregida y muestra la nueva versión", async () => {
    await mount();
    type(field("course.name"), "Ingeniería de Software II");
    type(field("course.teacher"), "");
    type(field(DUE_PATH), "2027-01-15");

    click(buttons("Save review")[0]);
    await vi.waitFor(() => expect(root().textContent).toContain("Review saved as version 2."));

    const put = backend.calls.find((call) => call.method === "PUT");
    expect(put.path).toBe(`/syllabi/${SYLLABUS_ID}/extraction`);
    expect(put.json.course.name).toBe("Ingeniería de Software II");
    expect(put.json.course.teacher).toBeNull();
    expect(put.json.gradingPeriods[1].units[0].activities[0].suggestedDueDate).toBe("2027-01-15");
    expect(put.json.uncertainFields).toEqual([]);
    expect(root().textContent).toContain("Version 2, reviewed by the teacher");
  });

  it("muestra el error del backend y permite reintentar", async () => {
    await mount(buildSyllabusExtraction(), async () => {
      throw Object.assign(new Error("invalid"), { code: "VALIDATION_ERROR" });
    });

    click(buttons("Save review")[0]);
    await vi.waitFor(() => expect(root().querySelector('[role="alert"]')).not.toBeNull());

    expect(root().querySelector('[role="alert"]').textContent).toBe(
      "The review could not be saved (VALIDATION_ERROR).",
    );
    expect(buttons("Save review")[0].disabled).toBe(false);
  });

  it("no envía nada si hay valores inválidos", async () => {
    await mount();
    type(field("gradingPeriods[0].weight"), "150");

    click(buttons("Save review")[0]);

    expect(backend.calls.some((call) => call.method === "PUT")).toBe(false);
  });
});

describe("generar la propuesta", () => {
  // "Save and generate the course proposal" before saving, "Generate the course proposal" after.
  const proposalButton = () => buttons("enerate the course proposal")[0];
  const PROPOSAL = {
    id: "11111111-1111-4111-8111-111111111111",
    courseId: 2,
    syllabusId: SYLLABUS_ID,
    extractionVersion: 2,
    status: "NEEDS_REVIEW",
    approvedBy: null,
    approvedAt: null,
    items: [],
    issues: [],
  };
  /** Lets the backend create the proposal on top of what `mount` set up. */
  const allowProposal = () => {
    const previous = backend.handler;
    backend.handler = async (call) =>
      call.method === "POST" && call.path === "/proposals" ? PROPOSAL : previous(call);
  };
  const proposalCall = () =>
    backend.calls.find((call) => call.method === "POST" && call.path === "/proposals");

  it("el botón dice qué hará: guardar y generar sobre la versión de la IA o con cambios, solo generar sobre la guardada", async () => {
    await mount();
    expect(proposalButton().textContent).toBe("Save and generate the course proposal");

    type(field("course.name"), "Otro nombre");
    click(buttons("Save review")[0]);
    await vi.waitFor(() => expect(root().textContent).toContain("Review saved as version 2."));
    expect(proposalButton().textContent).toBe("Generate the course proposal");

    type(field("course.name"), "Otro nombre más");
    expect(proposalButton().textContent).toBe("Save and generate the course proposal");
  });

  it("sobre la versión de la IA, un solo clic guarda la revisión y genera la propuesta", async () => {
    await mount();
    allowProposal();

    click(proposalButton());
    await vi.waitFor(() => expect(proposalCall()).toBeDefined());

    const methods = backend.calls.map((call) => `${call.method} ${call.path}`);
    expect(methods.indexOf(`PUT /syllabi/${SYLLABUS_ID}/extraction`)).toBeGreaterThan(-1);
    expect(methods.indexOf("POST /proposals")).toBeGreaterThan(
      methods.indexOf(`PUT /syllabi/${SYLLABUS_ID}/extraction`),
    );
    // La propuesta sale de la versión que se acaba de guardar, no de la de la IA.
    expect(proposalCall().json).toEqual({ syllabusId: SYLLABUS_ID, extractionVersion: 2 });
  });

  it("sobre una versión ya guardada y sin cambios no vuelve a guardar", async () => {
    await mount();
    type(field("course.name"), "Otro nombre");
    click(buttons("Save review")[0]);
    await vi.waitFor(() => expect(root().textContent).toContain("Review saved as version 2."));
    allowProposal();
    const saves = () => backend.calls.filter((call) => call.method === "PUT").length;
    expect(saves()).toBe(1);

    click(proposalButton());
    await vi.waitFor(() => expect(proposalCall()).toBeDefined());

    expect(saves()).toBe(1);
  });

  it("si guardar falla no genera la propuesta y muestra el error", async () => {
    await mount(buildSyllabusExtraction(), () => {
      throw Object.assign(new Error("no"), { code: "VERSION_CONFLICT" });
    });
    allowProposal();

    click(proposalButton());
    await vi.waitFor(() => expect(root().textContent).toContain("could not be saved"));

    expect(proposalCall()).toBeUndefined();
  });

  it("con valores inválidos no guarda ni genera", async () => {
    await mount();
    type(field("gradingPeriods[0].weight"), "150");

    expect(proposalButton().disabled).toBe(true);
    click(proposalButton());

    expect(backend.calls.some((call) => call.method === "PUT" || call.path === "/proposals")).toBe(
      false,
    );
  });

  it("pide la propuesta con la versión guardada y la muestra", async () => {
    await mount();
    type(field("course.name"), "Otro nombre");
    click(buttons("Save review")[0]);
    await vi.waitFor(() => expect(root().textContent).toContain("Review saved as version 2."));
    const previous = backend.handler;
    backend.handler = async (call) => {
      if (call.method === "POST" && call.path === "/proposals") {
        return {
          id: "11111111-1111-4111-8111-111111111111",
          courseId: 2,
          syllabusId: SYLLABUS_ID,
          extractionVersion: 2,
          status: "NEEDS_REVIEW",
          approvedBy: null,
          approvedAt: null,
          items: [],
          issues: [],
        };
      }
      return previous(call);
    };

    click(proposalButton());
    await vi.waitFor(() =>
      expect(document.querySelector('[data-region="proposal-preview"]').textContent).toContain(
        "Course proposal",
      ),
    );

    expect(
      backend.calls.find((call) => call.method === "POST" && call.path === "/proposals").json,
    ).toEqual({
      syllabusId: SYLLABUS_ID,
      extractionVersion: 2,
    });
  });
});
