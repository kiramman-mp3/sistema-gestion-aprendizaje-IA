// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backend } from "./stubs/assistant.mjs";
import { open } from "../../../moodle/local/ai_assistant/amd/src/proposal_preview.js";
import { settings } from "../../../moodle/local/ai_assistant/amd/src/publish_panel.js";

const PROPOSAL_ID = "11111111-1111-4111-8111-111111111111";
const SYLLABUS_ID = "22222222-2222-4222-8222-222222222222";
const OPERATION_ID = "33333333-3333-4333-8333-333333333333";

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
  publishError: null,
  ...extra,
});

const baseItems = () => [
  item("s1", "SECTION", null, 0, { title: "Requisitos" }),
  item("a1", "ASSIGN", "s1", 1, { title: "Especificación" }),
  item("s2", "SECTION", null, 2, { title: "Arquitectura" }),
  item("a2", "FORUM", "s2", 3, { title: "Foro" }),
];

const created = (items) =>
  items.map((i, n) => ({ ...i, publishStatus: "CREATED", moodleItemId: 100 + n }));

const proposal = (status, overrides = {}) => ({
  id: PROPOSAL_ID,
  courseId: 7,
  syllabusId: SYLLABUS_ID,
  extractionVersion: 2,
  status,
  approvedBy: status === "APPROVED" ? 42 : null,
  approvedAt: status === "APPROVED" ? "2026-11-09T15:00:00Z" : null,
  items: baseItems(),
  issues: [],
  lastPublishOperation: null,
  ...overrides,
});

const operation = (overrides = {}) => ({
  id: OPERATION_ID,
  proposalId: PROPOSAL_ID,
  status: "RUNNING",
  totalCount: 4,
  createdCount: 0,
  failedCount: 0,
  failures: [],
  createdAt: "2026-11-09T15:00:00Z",
  finishedAt: null,
  ...overrides,
});

const root = () => document.querySelector('[data-region="proposal-preview"]');
const text = () => root().textContent;
const buttons = (label) =>
  [...root().querySelectorAll("button")].filter((b) => b.textContent.includes(label));
const button = (label) => buttons(label)[0];
const confirmBox = () =>
  [...root().querySelectorAll('input[type="checkbox"]')].find((box) =>
    box.nextElementSibling?.textContent.startsWith("I confirm"),
  );
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const check = (box) => {
  box.checked = true;
  box.dispatchEvent(new Event("change", { bubbles: true }));
};
const typeInto = (node, value) => {
  node.value = value;
  node.dispatchEvent(new Event("input", { bubbles: true }));
};

/** Backend simulado: `state` es la propuesta que devuelve; `routes` responde por "MÉTODO ruta". */
const serve = (state, routes = {}) => {
  backend.calls = [];
  backend.handler = async (call) => {
    const key = `${call.method} ${call.path}`;
    if (routes[key]) return routes[key](call);
    if (key === `GET /proposals/${PROPOSAL_ID}`) return structuredClone(state.current);
    if (call.path.startsWith(`/syllabi/${SYLLABUS_ID}/extraction`)) {
      return { version: 2, content: { learningOutcomes: [{ id: "RA1" }] } };
    }
    throw Object.assign(new Error(`Ruta sin respuesta: ${key}`), { code: "NOT_FOUND" });
  };
};

beforeEach(() => {
  settings.pollIntervalMs = 0;
  document.body.innerHTML = `
    <div data-region="local_ai_assistant">
      <section class="d-none" data-region="proposal-preview"></section>
    </div>`;
});

describe("antes de publicar", () => {
  it("una propuesta en revisión no ofrece publicar", async () => {
    serve({ current: proposal("NEEDS_REVIEW") });

    await open(7, PROPOSAL_ID);

    expect(text()).not.toContain("Publish to Moodle");
    expect(button("Publish to the course")).toBeUndefined();
  });

  it("una propuesta aprobada pide confirmación explícita y no publica sin ella", async () => {
    serve({ current: proposal("APPROVED") });
    await open(7, PROPOSAL_ID);

    expect(text()).toContain("Publish to Moodle");
    expect(text()).toContain("Activities are created hidden");
    expect(button("Publish to the course").disabled).toBe(true);

    click(button("Publish to the course"));
    expect(backend.calls.some((call) => call.method === "POST")).toBe(false);

    check(confirmBox());
    expect(button("Publish to the course").disabled).toBe(false);
  });

  it("con cambios sin guardar no se puede publicar y se explica por qué", async () => {
    serve({ current: proposal("APPROVED") });
    await open(7, PROPOSAL_ID);
    check(confirmBox());

    typeInto(root().querySelector("input[type=text]"), "Otro título");

    expect(text()).toContain("Save or discard your changes before publishing");
    expect(button("Publish to the course").disabled).toBe(true);
    expect(confirmBox().disabled).toBe(true);
  });
});

describe("publicar", () => {
  /** Servidor que publica: POST crea la operación, el seguimiento la termina y la propuesta queda publicada. */
  const publishing = (extra = {}) => {
    const state = { current: proposal("APPROVED") };
    let polls = 0;
    serve(state, {
      [`POST /proposals/${PROPOSAL_ID}/publish`]: async () => operation(),
      [`GET /proposals/${PROPOSAL_ID}/publish-operations/${OPERATION_ID}`]: async () => {
        polls += 1;
        if (polls < 2) return operation({ createdCount: 2 });
        state.current = proposal("PUBLISHED", {
          items: created(baseItems()),
          lastPublishOperation: { id: OPERATION_ID, status: "SUCCEEDED" },
        });
        return operation({
          status: "SUCCEEDED",
          createdCount: 4,
          finishedAt: "2026-11-09T15:01:00Z",
        });
      },
      ...extra,
    });
    return state;
  };

  it("publica con confirmación, una clave de idempotencia y el cuerpo que exige el backend", async () => {
    publishing();
    await open(7, PROPOSAL_ID);
    check(confirmBox());

    click(button("Publish to the course"));
    await vi.waitFor(() =>
      expect(text()).toContain("Published: 4 elements were created in the course."),
    );

    const post = backend.calls.find((call) => call.method === "POST");
    expect(post.path).toBe(`/proposals/${PROPOSAL_ID}/publish`);
    expect(post.json).toEqual({ confirm: true });
    expect(post.headers["Idempotency-Key"]).toMatch(/^[A-Za-z0-9._:-]{16,128}$/);
  });

  it("muestra el progreso mientras se publica", async () => {
    let finish;
    const gate = new Promise((resolve) => (finish = resolve));
    const state = { current: proposal("APPROVED") };
    serve(state, {
      [`POST /proposals/${PROPOSAL_ID}/publish`]: async () => operation(),
      [`GET /proposals/${PROPOSAL_ID}/publish-operations/${OPERATION_ID}`]: async () => {
        await gate;
        return operation({ status: "SUCCEEDED", createdCount: 4 });
      },
    });
    await open(7, PROPOSAL_ID);
    check(confirmBox());

    click(button("Publish to the course"));
    await vi.waitFor(() => expect(text()).toContain("0 of 4 elements created"));

    expect(text()).toContain("Publishing to Moodle. You can leave this page");
    expect(button("Publish to the course")).toBeUndefined();
    expect(root().querySelector('[role="progressbar"]').getAttribute("aria-valuenow")).toBe("0");
    state.current = proposal("PUBLISHED", { items: created(baseItems()) });
    finish();
    await vi.waitFor(() => expect(text()).toContain("Published: 4 elements"));
  });

  it("al terminar resume lo creado con un enlace a Moodle para cada elemento", async () => {
    publishing();
    await open(7, PROPOSAL_ID);
    check(confirmBox());

    click(button("Publish to the course"));
    await vi.waitFor(() => expect(text()).toContain("Created in the course"));

    const links = [...root().querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual([
      "http://moodle.test/course/view.php?id=7&sectionid=100",
      "http://moodle.test/mod/view.php?id=101",
      "http://moodle.test/course/view.php?id=7&sectionid=102",
      "http://moodle.test/mod/view.php?id=103",
    ]);
    expect(text()).toContain("The activities are hidden");
    expect(text()).toContain("Assignment");
    expect([...root().querySelectorAll("a")].every((a) => a.rel.includes("noopener"))).toBe(true);
  });

  it("un doble clic no inicia dos publicaciones", async () => {
    publishing();
    await open(7, PROPOSAL_ID);
    check(confirmBox());
    const publish = button("Publish to the course");

    click(publish);
    click(publish);
    await vi.waitFor(() => expect(text()).toContain("Published: 4 elements"));

    expect(backend.calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("si no se pudo iniciar, muestra el error y reintenta con la misma clave", async () => {
    let attempts = 0;
    const keys = [];
    const state = { current: proposal("APPROVED") };
    serve(state, {
      [`POST /proposals/${PROPOSAL_ID}/publish`]: async (call) => {
        keys.push(call.headers["Idempotency-Key"]);
        attempts += 1;
        if (attempts === 1)
          throw Object.assign(new Error("red"), { code: "PUBLISH_QUEUE_UNAVAILABLE" });
        return operation({ status: "SUCCEEDED", createdCount: 4 });
      },
      [`GET /proposals/${PROPOSAL_ID}/publish-operations/${OPERATION_ID}`]: async () =>
        operation({ status: "SUCCEEDED", createdCount: 4 }),
    });
    await open(7, PROPOSAL_ID);
    check(confirmBox());

    click(button("Publish to the course"));
    await vi.waitFor(() =>
      expect(text()).toContain("The publication could not be started (PUBLISH_QUEUE_UNAVAILABLE)."),
    );
    click(button("Publish to the course"));
    await vi.waitFor(() => expect(keys).toHaveLength(2));

    expect(keys[1]).toBe(keys[0]);
  });
});

describe("después de un fallo", () => {
  const failedState = () =>
    proposal("FAILED", {
      items: baseItems().map((i, n) =>
        n < 2
          ? { ...i, publishStatus: "CREATED", moodleItemId: 100 + n }
          : n === 2
            ? { ...i, publishStatus: "FAILED", publishError: "MOODLE_UNAVAILABLE" }
            : i,
      ),
      lastPublishOperation: { id: OPERATION_ID, status: "FAILED" },
    });

  it("explica qué se creó, qué falló y por qué, y ofrece reanudar", async () => {
    serve({ current: failedState() });

    await open(7, PROPOSAL_ID);

    expect(text()).toContain("The publication stopped");
    expect(text()).toContain("2 of 4 elements were created. What was created is kept.");
    expect(text()).toContain("Arquitectura: Moodle did not respond");
    expect(text()).toContain("nothing will be created twice");
    expect(button("Resume the publication")).toBeDefined();
  });

  it("traduce cada causa de fallo", async () => {
    const cases = {
      MOODLE_PERMISSION: "you do not have permission to create this in the course",
      MOODLE_BAD_RESPONSE: "Moodle answered in an unexpected way",
      "MOODLE_ERROR:invalidparameter": "Moodle rejected it (invalidparameter)",
      PUBLISH_ERROR: "unexpected error",
    };
    for (const [code, expected] of Object.entries(cases)) {
      const state = failedState();
      state.items[2].publishError = code;
      serve({ current: state });

      await open(7, PROPOSAL_ID);

      expect(text()).toContain(`Arquitectura: ${expected}`);
    }
  });

  it("reanudar usa una clave nueva, no pide confirmar otra vez y termina la publicación", async () => {
    const state = { current: failedState() };
    serve(state, {
      [`POST /proposals/${PROPOSAL_ID}/publish`]: async () =>
        operation({ id: "44444444-4444-4444-8444-444444444444" }),
      [`GET /proposals/${PROPOSAL_ID}/publish-operations/44444444-4444-4444-8444-444444444444`]:
        async () => {
          state.current = proposal("PUBLISHED", { items: created(baseItems()) });
          return operation({
            id: "44444444-4444-4444-8444-444444444444",
            status: "SUCCEEDED",
            createdCount: 2,
          });
        },
    });
    await open(7, PROPOSAL_ID);
    expect(button("Resume the publication").disabled).toBe(false);

    click(button("Resume the publication"));
    await vi.waitFor(() => expect(text()).toContain("Published: 4 elements"));

    const post = backend.calls.find((call) => call.method === "POST");
    expect(post.json).toEqual({ confirm: true });
    expect(post.headers["Idempotency-Key"]).toBeTruthy();
  });
});

describe("al recargar la página", () => {
  it("una publicación en curso se retoma desde su última operación", async () => {
    let polls = 0;
    const state = {
      current: proposal("PUBLISHING", {
        lastPublishOperation: { id: OPERATION_ID, status: "RUNNING" },
      }),
    };
    serve(state, {
      [`GET /proposals/${PROPOSAL_ID}/publish-operations/${OPERATION_ID}`]: async () => {
        polls += 1;
        if (polls === 1) return operation({ createdCount: 1 });
        state.current = proposal("PUBLISHED", { items: created(baseItems()) });
        return operation({ status: "SUCCEEDED", createdCount: 4 });
      },
    });

    await open(7, PROPOSAL_ID);
    await vi.waitFor(() => expect(text()).toContain("Published: 4 elements"));

    expect(backend.calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("si no se puede leer el progreso, lo dice y no se queda cargando para siempre", async () => {
    serve(
      {
        current: proposal("PUBLISHING", {
          lastPublishOperation: { id: OPERATION_ID, status: "RUNNING" },
        }),
      },
      {
        [`GET /proposals/${PROPOSAL_ID}/publish-operations/${OPERATION_ID}`]: async () => {
          throw Object.assign(new Error("x"), { code: "NOT_FOUND" });
        },
      },
    );

    await open(7, PROPOSAL_ID);
    await vi.waitFor(() => expect(root().querySelector('[role="alert"]')).not.toBeNull());

    expect(root().querySelector('[role="alert"]').textContent).toBe(
      "The progress could not be read (NOT_FOUND). Reload the page to see the result.",
    );
  });

  it("una propuesta ya publicada muestra su resumen con enlaces", async () => {
    serve({
      current: proposal("PUBLISHED", {
        items: created(baseItems()),
        lastPublishOperation: { id: OPERATION_ID, status: "SUCCEEDED" },
      }),
    });

    await open(7, PROPOSAL_ID);

    expect(text()).toContain("Created in the course");
    expect([...root().querySelectorAll("a")]).toHaveLength(4);
    expect(backend.calls.filter((call) => call.path.includes("publish-operations"))).toHaveLength(
      0,
    );
  });
});
