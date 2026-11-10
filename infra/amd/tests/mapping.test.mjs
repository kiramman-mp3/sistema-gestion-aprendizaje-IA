// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activities, backend } from "./stubs/assistant.mjs";
import { init } from "../../../moodle/local/ai_assistant/amd/src/mapping.js";
import {
  buildRows,
  mappingErrorKind,
  staleRows,
  suggestedOutcomes,
  summarizeRows,
  toggleOutcome,
} from "../../../moodle/local/ai_assistant/amd/src/mapping_model.js";

const UNITS = [
  {
    unitRef: "gradingPeriods[0].units[0]",
    title: "Requisitos",
    periodName: "Primer parcial",
    learningOutcomeIds: ["RA1"],
  },
  {
    unitRef: "gradingPeriods[1].units[0]",
    title: "Arquitectura",
    periodName: "Segundo parcial",
    learningOutcomeIds: ["RA2"],
  },
];
const OUTCOMES = [
  { id: "RA1", description: "Especifica requisitos." },
  { id: "RA2", description: "Diseña la arquitectura." },
];
const ACTIVITIES = [
  {
    cmid: 21,
    name: "Tarea 1",
    modname: "assign",
    sectionnum: 1,
    sectionname: "Requisitos",
    visible: true,
  },
  {
    cmid: 22,
    name: "Foro",
    modname: "forum",
    sectionnum: 2,
    sectionname: "Arquitectura",
    visible: false,
  },
];

describe("modelo de la relación", () => {
  it("una fila por actividad, con su relación si la tiene", () => {
    const rows = buildRows(ACTIVITIES, [
      {
        moodleCmId: 21,
        unitRef: UNITS[0].unitRef,
        learningOutcomeIds: ["RA1"],
        source: "PROPOSAL",
      },
    ]);

    expect(rows[0]).toMatchObject({
      unitRef: UNITS[0].unitRef,
      learningOutcomeIds: ["RA1"],
      source: "PROPOSAL",
    });
    expect(rows[1]).toMatchObject({ unitRef: "", learningOutcomeIds: [], source: null });
  });

  it("cuenta lo relacionado y lo pendiente", () => {
    const rows = buildRows(ACTIVITIES, [
      { moodleCmId: 21, unitRef: UNITS[0].unitRef, learningOutcomeIds: [], source: "MANUAL" },
    ]);

    expect(summarizeRows(rows)).toEqual({ total: 2, related: 1, pending: 1 });
  });

  it("detecta relaciones con una unidad o un resultado que ya no existen", () => {
    const rows = [
      { unitRef: UNITS[0].unitRef, learningOutcomeIds: ["RA1"] },
      { unitRef: "gradingPeriods[9].units[0]", learningOutcomeIds: [] },
      { unitRef: UNITS[1].unitRef, learningOutcomeIds: ["RA9"] },
      { unitRef: "", learningOutcomeIds: [] },
    ];

    expect([...staleRows(rows, UNITS, OUTCOMES)]).toEqual([1, 2]);
  });

  it("sugiere los resultados de la unidad y alterna resultados sin repetir", () => {
    expect(suggestedOutcomes(UNITS[1].unitRef, UNITS)).toEqual(["RA2"]);
    expect(suggestedOutcomes("otra", UNITS)).toEqual([]);
    expect(toggleOutcome(["RA1"], "RA2", true)).toEqual(["RA1", "RA2"]);
    expect(toggleOutcome(["RA1", "RA2"], "RA1", false)).toEqual(["RA2"]);
    expect(toggleOutcome(["RA1"], "RA1", true)).toEqual(["RA1"]);
  });

  it("clasifica los errores", () => {
    expect(mappingErrorKind({ status: 403 })).toBe("forbidden");
    expect(mappingErrorKind({ code: "NO_REVIEWED_SYLLABUS", status: 409 })).toBe("noreviewed");
    expect(mappingErrorKind({ status: 400 })).toBe("invalid");
    expect(mappingErrorKind({ status: 500 })).toBe("other");
  });
});

const root = () => document.querySelector('[data-region="mapping"]');
const text = () => root().textContent;
const row = (cmid) => root().querySelector(`tr[data-cm="${cmid}"]`);
const select = (cmid) => row(cmid).querySelector("select");
const boxes = (cmid) => [...row(cmid).querySelectorAll('input[type="checkbox"]')];
const choose = (node, value) => {
  node.value = value;
  node.dispatchEvent(new Event("change", { bubbles: true }));
};
const toggle = (box, checked) => {
  box.checked = checked;
  box.dispatchEvent(new Event("change", { bubbles: true }));
};

const serve = ({ publish = true, units = UNITS, mappings = [], routes = {} } = {}) => {
  backend.calls = [];
  backend.handler = async (call) => {
    const key = `${call.method} ${call.path}`;
    if (routes[key]) return routes[key](call);
    if (key === "GET /session")
      return { capabilities: { use: true, publish, viewanalytics: true } };
    if (key === "GET /courses/7/activity-mappings")
      return {
        syllabusId: "s",
        extractionVersion: 1,
        units,
        outcomes: units.length ? OUTCOMES : [],
        mappings,
      };
    const put = /^PUT \/courses\/7\/activity-mappings\/(\d+)$/.exec(key);
    if (put) return { moodleCmId: Number(put[1]), ...call.json, source: "MANUAL" };
    if (/^DELETE /.test(key)) return {};
    throw Object.assign(new Error(`Ruta sin respuesta: ${key}`), { code: "NOT_FOUND" });
  };
};

beforeEach(() => {
  activities.list = structuredClone(ACTIVITIES);
  activities.fails = false;
  document.body.innerHTML = `
    <div data-region="local_ai_assistant">
      <section class="d-none" data-region="mapping"></section>
    </div>`;
});

describe("pantalla de relación", () => {
  it("lista las actividades de Moodle con su sección y tipo, y cuántas están relacionadas", async () => {
    serve({
      mappings: [
        {
          moodleCmId: 21,
          unitRef: UNITS[0].unitRef,
          learningOutcomeIds: ["RA1"],
          source: "PROPOSAL",
        },
      ],
    });

    await init(7);

    expect(text()).toContain("Activities and syllabus units");
    expect(text()).toContain("Tarea 1");
    expect(text()).toContain("assign · Requisitos");
    expect(text()).toContain("forum · Arquitectura · hidden");
    expect(text()).toContain("1 of 2 activities related");
    expect(select(21).value).toBe(UNITS[0].unitRef);
    expect(boxes(21).map((b) => b.checked)).toEqual([true, false]);
    expect(text()).toContain("Created from the proposal");
  });

  it("sin sílabo revisado explica qué falta y no muestra la tabla", async () => {
    serve({ units: [] });

    await init(7);

    expect(text()).toContain("Review and save the structure extracted from the syllabus first");
    expect(root().querySelector("table")).toBeNull();
  });

  it("un curso sin actividades lo dice", async () => {
    activities.list = [];
    serve();

    await init(7);

    expect(text()).toContain("The course has no activities yet.");
  });

  it("si Moodle no entrega las actividades, muestra el error", async () => {
    activities.fails = true;
    serve();

    await init(7);

    expect(root().querySelector('[role="alert"]').textContent).toBe(
      "The activities could not be loaded (ajax_error).",
    );
  });

  it("sin la capacidad publish se ve pero no se puede cambiar", async () => {
    serve({
      publish: false,
      mappings: [
        {
          moodleCmId: 21,
          unitRef: UNITS[0].unitRef,
          learningOutcomeIds: ["RA1"],
          source: "MANUAL",
        },
      ],
    });

    await init(7);

    expect(text()).toContain("You can see the relations but not change them.");
    expect(select(21).disabled).toBe(true);
    expect(boxes(21).every((b) => b.disabled)).toBe(true);
  });

  it("marca una relación que apunta a algo que ya no está en el sílabo", async () => {
    serve({
      mappings: [
        {
          moodleCmId: 21,
          unitRef: "gradingPeriods[9].units[0]",
          learningOutcomeIds: [],
          source: "MANUAL",
        },
      ],
    });

    await init(7);

    expect(text()).toContain("no longer in the syllabus");
  });
});

describe("guardar cambios", () => {
  it("al elegir una unidad se guarda de inmediato, con los resultados que el sílabo le asigna", async () => {
    serve();
    await init(7);

    choose(select(21), UNITS[1].unitRef);
    await vi.waitFor(() => expect(row(21).textContent).toContain("Saved"));

    const put = backend.calls.find((call) => call.method === "PUT");
    expect(put.path).toBe("/courses/7/activity-mappings/21");
    expect(put.json).toEqual({ unitRef: UNITS[1].unitRef, learningOutcomeIds: ["RA2"] });
    expect(select(21).value).toBe(UNITS[1].unitRef);
    expect(boxes(21).map((b) => b.checked)).toEqual([false, true]);
    expect(text()).toContain("1 of 2 activities related");
  });

  it("al marcar un resultado se guarda la lista completa", async () => {
    serve({
      mappings: [
        {
          moodleCmId: 21,
          unitRef: UNITS[0].unitRef,
          learningOutcomeIds: ["RA1"],
          source: "PROPOSAL",
        },
      ],
    });
    await init(7);

    toggle(boxes(21)[1], true);
    await vi.waitFor(() => expect(row(21).textContent).toContain("Saved"));

    expect(backend.calls.find((call) => call.method === "PUT").json).toEqual({
      unitRef: UNITS[0].unitRef,
      learningOutcomeIds: ["RA1", "RA2"],
    });
  });

  it("cambiar de unidad conserva los resultados que el docente ya eligió", async () => {
    serve({
      mappings: [
        {
          moodleCmId: 21,
          unitRef: UNITS[0].unitRef,
          learningOutcomeIds: ["RA1", "RA2"],
          source: "MANUAL",
        },
      ],
    });
    await init(7);

    choose(select(21), UNITS[1].unitRef);
    await vi.waitFor(() => expect(row(21).textContent).toContain("Saved"));

    expect(backend.calls.find((call) => call.method === "PUT").json.learningOutcomeIds).toEqual([
      "RA1",
      "RA2",
    ]);
  });

  it("sin unidad los resultados están desactivados", async () => {
    serve();
    await init(7);

    expect(boxes(21).every((b) => b.disabled)).toBe(true);
  });

  it("elegir «Sin relacionar» quita la relación", async () => {
    serve({
      mappings: [
        {
          moodleCmId: 21,
          unitRef: UNITS[0].unitRef,
          learningOutcomeIds: ["RA1"],
          source: "MANUAL",
        },
      ],
    });
    await init(7);

    choose(select(21), "");
    await vi.waitFor(() => expect(row(21).textContent).toContain("Saved"));

    expect(
      backend.calls.some(
        (call) => call.method === "DELETE" && call.path === "/courses/7/activity-mappings/21",
      ),
    ).toBe(true);
    expect(select(21).value).toBe("");
    expect(text()).toContain("0 of 2 activities related");
  });

  it("si no se puede guardar, lo dice en esa fila y no cambia el resumen", async () => {
    serve({
      routes: {
        "PUT /courses/7/activity-mappings/21": async () => {
          throw Object.assign(new Error("x"), { status: 400, code: "VALIDATION_ERROR" });
        },
      },
    });
    await init(7);

    choose(select(21), UNITS[0].unitRef);
    await vi.waitFor(() => expect(row(21).querySelector('[role="alert"]')).not.toBeNull());

    expect(row(21).querySelector('[role="alert"]').textContent).toBe(
      "That unit or outcome is not in the syllabus.",
    );
    expect(text()).toContain("0 of 2 activities related");
  });
});
