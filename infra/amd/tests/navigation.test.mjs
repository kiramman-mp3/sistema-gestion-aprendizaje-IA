// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backend } from "./stubs/assistant.mjs";
import { activate, init } from "../../../moodle/local/ai_assistant/amd/src/navigation.js";
import { generate } from "../../../moodle/local/ai_assistant/amd/src/proposal_preview.js";

const TABS = ["syllabus", "proposal", "chat", "analytics"];

/** La página con sus pestañas y paneles; todas menos «syllabus» empiezan ocultas, como en la plantilla. */
const page = () => {
  document.body.innerHTML = `
    <div data-region="local_ai_assistant">
      <div role="tablist">
        ${TABS.map(
          (name) =>
            `<button type="button" role="tab" data-tab="${name}" aria-selected="${name === "syllabus"}" ${
              name === "syllabus" ? "" : "hidden tabindex='-1'"
            }>${name}</button>`,
        ).join("")}
      </div>
      <div role="tabpanel" data-panel="syllabus"><section data-region="syllabus"></section></div>
      <div role="tabpanel" data-panel="proposal" hidden><section class="d-none" data-region="proposal-preview"></section></div>
      <div role="tabpanel" data-panel="chat" hidden><section class="d-none" data-region="chat"><div role="log"></div></section></div>
      <div role="tabpanel" data-panel="analytics" hidden><section class="d-none" data-region="analytics"></section></div>
    </div>`;
};

const tab = (name) => document.querySelector(`[role="tab"][data-tab="${name}"]`);
const panel = (name) => document.querySelector(`[data-panel="${name}"]`);
const region = (name) => document.querySelector(`[data-region="${name}"]`);
const visibleTabs = () => [...document.querySelectorAll('[role="tab"]')].filter((t) => !t.hidden).map((t) => t.dataset.tab);
const selected = () => document.querySelector('[role="tab"][aria-selected="true"]')?.dataset.tab;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  page();
});

describe("arranque", () => {
  it("abre el sílabo y solo muestra su panel", () => {
    init();

    expect(selected()).toBe("syllabus");
    expect(panel("syllabus").hidden).toBe(false);
    expect(panel("proposal").hidden).toBe(true);
    expect(panel("chat").hidden).toBe(true);
  });

  it("una propuesta en la URL abre su pestaña aunque aún no se haya dibujado", () => {
    init({ proposalId: "p1" });

    expect(selected()).toBe("proposal");
    expect(tab("proposal").hidden).toBe(false);
    expect(panel("proposal").hidden).toBe(false);
    expect(panel("syllabus").hidden).toBe(true);
  });

  it("solo la pestaña con contenido está a la vista", () => {
    init();

    expect(visibleTabs()).toEqual(["syllabus"]);
  });

  it("no hace nada si la página no tiene pestañas", () => {
    document.body.innerHTML = '<div data-region="local_ai_assistant"></div>';

    expect(() => init()).not.toThrow();
  });
});

describe("pestañas según lo que cada pantalla muestre", () => {
  it("aparece la pestaña cuando su pantalla se muestra y desaparece cuando se oculta", async () => {
    init();

    region("chat").classList.remove("d-none");
    await tick();
    expect(visibleTabs()).toEqual(["syllabus", "chat"]);

    region("chat").classList.add("d-none");
    await tick();
    expect(visibleTabs()).toEqual(["syllabus"]);
  });

  it("la pestaña abierta no desaparece aunque su pantalla se oculte", async () => {
    init({ proposalId: "p1" });
    await tick();

    expect(tab("proposal").hidden).toBe(false);
  });
});

describe("cambiar de pestaña", () => {
  beforeEach(async () => {
    init();
    for (const name of ["proposal-preview", "chat", "analytics"]) {
      region(name).classList.remove("d-none");
    }
    await tick();
  });

  it("el clic muestra el panel y marca la pestaña", () => {
    tab("chat").click();

    expect(selected()).toBe("chat");
    expect(panel("chat").hidden).toBe(false);
    expect(panel("syllabus").hidden).toBe(true);
    expect(tab("chat").tabIndex).toBe(0);
    expect(tab("syllabus").tabIndex).toBe(-1);
  });

  it("al volver a una conversación la lleva al último mensaje", () => {
    const log = document.querySelector('[role="log"]');
    Object.defineProperty(log, "scrollHeight", { value: 500 });

    tab("chat").click();

    expect(log.scrollTop).toBe(500);
  });

  it("las flechas, Inicio y Fin recorren las pestañas visibles", () => {
    tab("syllabus").focus();
    const press = (key) => document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

    press("ArrowRight");
    expect(selected()).toBe("proposal");
    expect(document.activeElement).toBe(tab("proposal"));

    press("End");
    expect(selected()).toBe("analytics");

    press("ArrowRight");
    expect(selected()).toBe("syllabus");

    press("ArrowLeft");
    expect(selected()).toBe("analytics");

    press("Home");
    expect(selected()).toBe("syllabus");
  });

  it("otras teclas no cambian de pestaña", () => {
    tab("syllabus").focus();

    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));

    expect(selected()).toBe("syllabus");
  });
});

describe("activate", () => {
  it("lo llaman otros módulos para llevar al docente a una pestaña", () => {
    init();

    activate("chat");

    expect(selected()).toBe("chat");
    expect(panel("chat").hidden).toBe(false);
  });

  it("ignora una pestaña que no existe", () => {
    init();

    activate("nada");

    expect(selected()).toBe("syllabus");
  });
});

describe("al generar la propuesta", () => {
  it("lleva al docente a la pestaña de la propuesta", async () => {
    init();
    backend.calls = [];
    backend.handler = async (call) =>
      call.method === "POST"
        ? { id: "p1", syllabusId: "s1", extractionVersion: 1, status: "NEEDS_REVIEW", approvedBy: null, approvedAt: null, items: [], issues: [] }
        : { content: { learningOutcomes: [] } };

    await generate(7, "s1", 1);

    await vi.waitFor(() => expect(selected()).toBe("proposal"));
    expect(panel("proposal").hidden).toBe(false);
  });
});
