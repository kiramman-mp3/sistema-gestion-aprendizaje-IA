// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backend } from "./stubs/assistant.mjs";
import { init } from "../../../moodle/local/ai_assistant/amd/src/admin.js";

const root = () => document.querySelector('[data-region="admin"]');
const text = () => root().textContent;
const button = (label) =>
  [...root().querySelectorAll("button")].find((b) => b.textContent.includes(label));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const submit = (form) =>
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

const EVENT = (n, extra = {}) => ({
  id: `e${n}`,
  createdAt: "2026-11-10T12:00:00Z",
  action: "proposal.publish",
  outcome: "SUCCESS",
  actorMoodleId: 4,
  courseId: 7,
  resourceType: "proposal",
  resourceId: `p${n}`,
  metadata: { items: n },
  ...extra,
});

const RULES = {
  courseId: null,
  rules: [
    { rule: "MISSING_REQUIRED", scope: "default", enabled: true, params: { minMissing: 2 } },
    {
      rule: "GRADE_BELOW_THRESHOLD",
      scope: "institution",
      enabled: true,
      params: { thresholdPercent: 60, minActivities: 2 },
    },
    { rule: "SUSTAINED_DECLINE", scope: "default", enabled: false, params: { consecutive: 3 } },
    {
      rule: "REPEATED_OUTCOME_DIFFICULTY",
      scope: "default",
      enabled: true,
      params: { thresholdPercent: 60, minActivities: 2 },
    },
  ],
};

const serve = (routes = {}, { admin = true } = {}) => {
  backend.calls = [];
  backend.handler = async (call) => {
    const key = `${call.method} ${call.path}`;
    for (const [pattern, handler] of Object.entries(routes)) {
      if (key === pattern || (pattern.endsWith("*") && key.startsWith(pattern.slice(0, -1))))
        return handler(call);
    }
    if (key === "GET /session")
      return {
        moodleUserId: 4,
        courseId: 7,
        roles: ["manager"],
        capabilities: { use: true, publish: true, viewanalytics: true, admin },
      };
    if (key.startsWith("GET /audit"))
      return {
        items: [EVENT(1), EVENT(2, { outcome: "DENIED", actorMoodleId: null, courseId: null })],
        nextCursor: null,
      };
    if (key.startsWith("GET /admin/difficulty-rules")) return structuredClone(RULES);
    throw Object.assign(new Error(`Ruta sin respuesta: ${key}`), {
      code: "NOT_FOUND",
      status: 404,
    });
  };
};

beforeEach(() => {
  document.body.innerHTML = `
    <div data-region="local_ai_assistant">
      <section class="d-none" data-region="admin"></section>
    </div>`;
});

describe("quién ve la administración", () => {
  it("sin el permiso admin no se dibuja ni se pide nada más", async () => {
    serve({}, { admin: false });

    await init(7);

    expect(root().classList.contains("d-none")).toBe(true);
    expect(backend.calls.map((c) => c.path)).toEqual(["/session"]);
  });

  it("si la sesión falla, tampoco se dibuja", async () => {
    backend.handler = async () => {
      throw new Error("sin conexión");
    };

    await init(7);

    expect(root().classList.contains("d-none")).toBe(true);
  });
});

describe("auditoría (CU-07)", () => {
  it("muestra los eventos más recientes, con el resultado y el detalle sin datos personales", async () => {
    serve();

    await init(7);
    await vi.waitFor(() => expect(root().querySelectorAll("tbody tr")).toHaveLength(2));

    expect(backend.calls.map((c) => c.path)).toContain("/audit?limit=50");
    expect(text()).toContain("proposal.publish");
    expect(text()).toContain("proposal p1, items=1");
    expect(text()).toContain("Denied");
    const second = root().querySelectorAll("tbody tr")[1].textContent;
    expect(second).toContain("—");
  });

  it("con los filtros pide al backend solo lo escrito", async () => {
    serve();
    await init(7);
    await vi.waitFor(() => expect(root().querySelector("form")).not.toBeNull());
    const form = root().querySelector("form");
    form.elements.action.value = "auth.";
    form.elements.outcome.value = "DENIED";
    form.elements.courseId.value = "7";

    submit(form);

    await vi.waitFor(() => {
      const last = backend.calls.at(-1).path;
      expect(last).toContain("action=auth.");
      expect(last).toContain("outcome=DENIED");
      expect(last).toContain("courseId=7");
    });
  });

  it("sin eventos lo dice", async () => {
    serve({ "GET /audit*": async () => ({ items: [], nextCursor: null }) });

    await init(7);

    await vi.waitFor(() => expect(text()).toContain("There are no events with these filters."));
  });

  it("«Cargar más» pide la página siguiente con el cursor y agrega las filas", async () => {
    let page = 0;
    serve({
      "GET /audit*": async () => {
        page += 1;
        return page === 1
          ? { items: [EVENT(1)], nextCursor: "c1" }
          : { items: [EVENT(2)], nextCursor: null };
      },
    });
    await init(7);
    await vi.waitFor(() => expect(button("Load more")).toBeDefined());

    click(button("Load more"));

    await vi.waitFor(() => expect(root().querySelectorAll("tbody tr")).toHaveLength(2));
    expect(backend.calls.at(-1).path).toContain("cursor=c1");
    expect(button("Load more")).toBeUndefined();
  });

  it("un error del backend se explica", async () => {
    serve({
      "GET /audit*": async () => {
        throw Object.assign(new Error("x"), { status: 403, code: "FORBIDDEN_CAPABILITY" });
      },
    });

    await init(7);

    await vi.waitFor(() => expect(text()).toContain("You do not have permission to administer"));
  });

  it("un valor que parece HTML se muestra como texto", async () => {
    serve({
      "GET /audit*": async () => ({
        items: [EVENT(1, { action: "<img src=x onerror=alert(1)>" })],
        nextCursor: null,
      }),
    });

    await init(7);

    await vi.waitFor(() => expect(text()).toContain("<img src=x onerror=alert(1)>"));
    expect(root().querySelector("img")).toBeNull();
  });
});

describe("reglas de dificultad (CU-06)", () => {
  const openRules = async () => {
    serve();
    await init(7);
    await vi.waitFor(() => expect(button("Difficulty rules")).toBeDefined());
    click(button("Difficulty rules"));
    await vi.waitFor(() => expect(root().querySelectorAll("section.card")).toHaveLength(4));
  };

  it("muestra las cuatro reglas con su alcance y sus valores", async () => {
    await openRules();

    expect(backend.calls.map((c) => c.path)).toContain("/admin/difficulty-rules");
    const cards = [...root().querySelectorAll("section.card")];
    expect(cards[0].textContent).toContain("Overdue activities not submitted");
    expect(cards[0].textContent).toContain("Default");
    expect(cards[1].textContent).toContain("Institution");
    expect(cards[1].querySelector("input[type=number]").value).toBe("60");
    expect(cards[2].querySelector("input[type=checkbox]").checked).toBe(false);
  });

  it("al elegir «Este curso» pide las reglas del curso", async () => {
    await openRules();

    click(root().querySelector('input[type="radio"][value="course"]'));
    root()
      .querySelector('input[type="radio"][value="course"]')
      .dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() =>
      expect(backend.calls.at(-1).path).toBe("/admin/difficulty-rules?courseId=7"),
    );
  });

  it("guarda con PUT y muestra el alcance que devuelve el backend", async () => {
    await openRules();
    backend.calls = [];
    backend.handler = async (call) => ({
      rule: "MISSING_REQUIRED",
      scope: "institution",
      enabled: true,
      params: call.json.params,
    });
    const card = root().querySelector("section.card");
    card.querySelector("input[type=number]").value = "3";

    submit(card.querySelector("form"));

    await vi.waitFor(() => expect(text()).toContain("Rule saved."));
    expect(backend.calls[0]).toMatchObject({
      method: "PUT",
      path: "/admin/difficulty-rules/MISSING_REQUIRED",
      json: { courseId: null, enabled: true, params: { minMissing: 3 } },
    });
    expect(card.querySelector(".badge").textContent).toBe("Institution");
  });

  it("un valor fuera de rango no se manda y se marca el campo", async () => {
    await openRules();
    backend.calls = [];
    const card = root().querySelectorAll("section.card")[2];
    card.querySelector("input[type=number]").value = "2";

    submit(card.querySelector("form"));

    expect(backend.calls).toEqual([]);
    expect(card.querySelector("input[type=number]").classList.contains("is-invalid")).toBe(true);
    expect(card.textContent).toContain("Enter a number between 3 and 10.");
  });

  it("si el backend rechaza el cuerpo, lista los campos", async () => {
    await openRules();
    backend.handler = async () => {
      throw Object.assign(new Error("x"), {
        status: 400,
        code: "VALIDATION_ERROR",
        details: [{ path: "params.minMissing", message: "Too small" }],
      });
    };
    const card = root().querySelector("section.card");

    submit(card.querySelector("form"));

    await vi.waitFor(() => expect(card.textContent).toContain("params.minMissing: Too small"));
  });

  it("«Quitar esta configuración» manda DELETE y vuelve a cargar las reglas", async () => {
    await openRules();
    backend.calls = [];
    backend.handler = async (call) => (call.method === "DELETE" ? {} : structuredClone(RULES));

    click(root().querySelectorAll("section.card")[1].querySelector("button.btn-outline-secondary"));

    await vi.waitFor(() => expect(text()).toContain("Setting removed."));
    expect(backend.calls[0]).toMatchObject({
      method: "DELETE",
      path: "/admin/difficulty-rules/GRADE_BELOW_THRESHOLD",
    });
    expect(backend.calls[1]).toMatchObject({ method: "GET", path: "/admin/difficulty-rules" });
  });

  it("quitar una regla que no tenía configuración propia avisa sin error", async () => {
    await openRules();
    backend.handler = async () => {
      throw Object.assign(new Error("x"), { status: 404, code: "RULE_NOT_FOUND" });
    };
    const card = root().querySelector("section.card");

    click(card.querySelector("button.btn-outline-secondary"));

    await vi.waitFor(() => expect(card.textContent).toContain("has no setting of its own"));
    expect(card.querySelector('[role="alert"]')).toBeNull();
  });
});
