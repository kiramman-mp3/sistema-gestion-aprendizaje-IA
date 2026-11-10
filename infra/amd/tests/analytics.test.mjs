// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backend, students } from "./stubs/assistant.mjs";
import { init } from "../../../moodle/local/ai_assistant/amd/src/analytics.js";

const root = () => document.querySelector('[data-region="analytics"]');
const text = () => root().textContent;
const buttons = (label) =>
  [...root().querySelectorAll("button")].filter((b) => b.textContent.includes(label));
const button = (label) => buttons(label)[0];
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const typeInto = (node, value) => {
  node.value = value;
  node.dispatchEvent(new Event("input", { bubbles: true }));
};

const ANALYTICS = {
  courseId: 7,
  computedAt: "2026-11-09T15:00:00Z",
  indicators: [
    {
      key: "submission_rate",
      label: "Tasa de entrega",
      value: 82.5,
      unit: "%",
      definition: "Entregas a tiempo sobre entregas esperadas.",
    },
    {
      key: "average_grade",
      label: "Promedio",
      value: null,
      unit: null,
      definition: "Promedio de las calificaciones publicadas.",
    },
  ],
  signals: [
    {
      studentId: 3,
      rule: "MISSING_REQUIRED",
      explanation: "No entregó 2 de 3 tareas obligatorias.",
    },
    {
      studentId: 3,
      rule: "SUSTAINED_DECLINE",
      explanation: "Sus notas bajaron en tres tareas seguidas.",
    },
    {
      studentId: 5,
      rule: "GRADE_BELOW_THRESHOLD",
      explanation: "Promedio de 5,5 con umbral de 7.",
    },
  ],
};

const EVIDENCE = {
  courseId: 7,
  studentId: 3,
  observed: [
    { label: "Tareas entregadas", value: 1 },
    { tarea: "Tarea 3", estado: "sin entrega" },
  ],
  computed: [
    {
      key: "on_time",
      label: "Entregas a tiempo",
      value: 1,
      unit: null,
      definition: "Cantidad de entregas dentro del plazo.",
    },
  ],
  unknown: ["No hay notas de la primera unidad."],
};

const RECOMMENDATION = {
  id: "11111111-1111-4111-8111-111111111111",
  evidenceSummary: ["Una de tres tareas entregada."],
  strengths: [],
  difficulties: ["Entregas pendientes."],
  missingInformation: ["Notas de la primera unidad."],
  strategies: ["Tutoría breve para ordenar los pendientes."],
  reinforcementActivities: [],
  followUpIndicators: ["Entregas a tiempo en las próximas dos semanas."],
};

const serve = (routes = {}, { viewanalytics = true } = {}) => {
  backend.calls = [];
  backend.handler = async (call) => {
    const key = `${call.method} ${call.path}`;
    if (routes[key]) return routes[key](call);
    if (key === "GET /session")
      return {
        moodleUserId: 4,
        courseId: 7,
        roles: ["editingteacher"],
        capabilities: { use: true, publish: true, viewanalytics },
      };
    if (key === "GET /analytics/courses/7") return structuredClone(ANALYTICS);
    if (key === "GET /analytics/courses/7/students/3") return structuredClone(EVIDENCE);
    throw Object.assign(new Error(`Ruta sin respuesta: ${key}`), {
      code: "NOT_FOUND",
      status: 404,
    });
  };
};

beforeEach(() => {
  students.list = [
    { id: 3, fullname: "Carla Cedeño" },
    { id: 5, fullname: "Andrés Álvarez" },
  ];
  students.fails = false;
  document.body.innerHTML = `
    <div data-region="local_ai_assistant">
      <section class="d-none" data-region="analytics"></section>
    </div>`;
});

describe("panel del docente", () => {
  it("quien no puede ver la analítica no ve el panel ni se le pide nada más", async () => {
    serve({}, { viewanalytics: false });

    await init(7);

    expect(root().classList.contains("d-none")).toBe(true);
    expect(backend.calls.map((call) => call.path)).toEqual(["/session"]);
  });

  it("muestra los indicadores con su definición, y un valor que falta como guion", async () => {
    serve();

    await init(7);

    expect(root().classList.contains("d-none")).toBe(false);
    expect(text()).toContain("Course analytics");
    expect(text()).toContain("A signal is not a diagnosis");
    expect(text()).toContain("Calculated on");
    expect(text()).toContain("Tasa de entrega");
    expect(text()).toContain("Entregas a tiempo sobre entregas esperadas.");
    expect(text()).toContain("Promedio");
    expect(text()).toContain("—");
  });

  it("muestra cada señal con su estudiante (por nombre), su regla y su explicación", async () => {
    serve();

    await init(7);

    expect(text()).toContain("Carla Cedeño");
    expect(text()).toContain("Andrés Álvarez");
    expect(text()).toContain("Required work missing");
    expect(text()).toContain("Sustained decline");
    expect(text()).toContain("Grade below the threshold");
    expect(text()).toContain("No entregó 2 de 3 tareas obligatorias.");
    // Carla tiene dos señales y va primero.
    expect(text().indexOf("Carla Cedeño")).toBeLessThan(text().indexOf("Andrés Álvarez"));
  });

  it("los nombres vienen de Moodle: el backend solo recibe el id del estudiante", async () => {
    serve();

    await init(7);
    click(buttons("View evidence")[0]);
    await vi.waitFor(() => expect(text()).toContain("Evidence of Carla Cedeño"));

    expect(JSON.stringify(backend.calls)).not.toContain("Carla");
    expect(backend.calls.at(-1).path).toBe("/analytics/courses/7/students/3");
  });

  it("si no se pueden cargar los nombres, muestra los ids y lo avisa", async () => {
    students.fails = true;
    serve();

    await init(7);

    expect(text()).toContain("Student names could not be loaded");
    expect(text()).toContain("Student 3");
    expect(text()).toContain("Student 5");
  });

  it("un estudiante que Moodle ya no lista no pierde su señal", async () => {
    students.list = [];
    serve();

    await init(7);

    expect(text()).toContain("Student 3");
    expect(text()).toContain("No entregó 2 de 3 tareas obligatorias.");
  });

  it("sin señales lo dice", async () => {
    serve({ "GET /analytics/courses/7": async () => ({ ...ANALYTICS, signals: [] }) });

    await init(7);

    expect(text()).toContain("No signals");
  });

  it("una regla que el plugin no conoce se muestra con su código", async () => {
    serve({
      "GET /analytics/courses/7": async () => ({
        ...ANALYTICS,
        signals: [{ studentId: 3, rule: "REGLA_NUEVA", explanation: "Algo nuevo." }],
      }),
    });

    await init(7);

    expect(text()).toContain("REGLA_NUEVA");
    expect(text()).toContain("Algo nuevo.");
  });

  it("si la analítica no carga, muestra el error", async () => {
    serve({
      "GET /analytics/courses/7": async () => {
        throw Object.assign(new Error("x"), { status: 403, code: "FORBIDDEN_CAPABILITY" });
      },
    });

    await init(7);

    expect(root().querySelector('[role="alert"]').textContent).toBe(
      "You do not have permission to view the analytics of this course.",
    );
  });
});

describe("análisis del estudiante", () => {
  const openStudent = async () => {
    serve();
    await init(7);
    click(buttons("View evidence")[0]);
    await vi.waitFor(() => expect(text()).toContain("Evidence of"));
  };

  it("separa lo observado en Moodle, lo calculado y lo que falta", async () => {
    await openStudent();

    expect(text()).toContain("Observed in Moodle");
    expect(text()).toContain("Tareas entregadas");
    expect(text()).toContain("sin entrega");
    expect(text()).toContain("Calculated");
    expect(text()).toContain("Entregas a tiempo");
    expect(text()).toContain("Missing information");
    expect(text()).toContain("No hay notas de la primera unidad.");
    expect(text()).toContain("cannot conclude anything about this");
  });

  it("Volver regresa al panel", async () => {
    await openStudent();

    click(button("Back to the course"));
    await vi.waitFor(() => expect(text()).toContain("Signals to review"));
  });

  it("genera recomendaciones y las muestra con el aviso de que no son un diagnóstico", async () => {
    await openStudent();
    backend.handler = ((previous) => async (call) =>
      call.method === "POST" && call.path === "/analytics/courses/7/students/3/recommendations"
        ? structuredClone(RECOMMENDATION)
        : previous(call))(backend.handler);

    click(button("Generate pedagogical recommendations"));
    await vi.waitFor(() => expect(text()).toContain("Suggested strategies"));

    expect(text()).toContain("They are not a diagnosis");
    expect(text()).toContain("Tutoría breve para ordenar los pendientes.");
    expect(text()).toContain("Evidence used");
    expect(text()).toContain("Indicators to follow");
    // Las partes vacías no se muestran.
    expect(text()).not.toContain("Strengths");
    expect(text()).not.toContain("Reinforcement activities");
  });

  it("si no hay datos suficientes, lo explica y no inventa recomendaciones", async () => {
    await openStudent();
    backend.handler = ((previous) => async (call) => {
      if (call.method === "POST")
        throw Object.assign(new Error("x"), { status: 422, code: "INSUFFICIENT_DATA" });
      return previous(call);
    })(backend.handler);

    click(button("Generate pedagogical recommendations"));
    await vi.waitFor(() => expect(text()).toContain("There is not enough data"));

    expect(text()).not.toContain("Suggested strategies");
    expect(button("Generate pedagogical recommendations").disabled).toBe(false);
  });

  it("si el proveedor de IA no responde, lo dice", async () => {
    await openStudent();
    backend.handler = ((previous) => async (call) => {
      if (call.method === "POST")
        throw Object.assign(new Error("x"), { status: 503, code: "AI_PROVIDER_UNAVAILABLE" });
      return previous(call);
    })(backend.handler);

    click(button("Generate pedagogical recommendations"));

    await vi.waitFor(() => expect(text()).toContain("No recommendations were generated"));
  });

  describe("seguimiento docente", () => {
    const withRecommendation = async () => {
      await openStudent();
      backend.handler = ((previous) => async (call) => {
        if (call.method === "POST" && call.path.endsWith("/recommendations"))
          return structuredClone(RECOMMENDATION);
        if (call.method === "POST" && call.path.endsWith("/followups")) return {};
        return previous(call);
      })(backend.handler);
      click(button("Generate pedagogical recommendations"));
      await vi.waitFor(() => expect(text()).toContain("Record your follow-up"));
    };
    const fields = () => [...root().querySelectorAll("form textarea")];

    it("no se puede guardar sin decir qué se hizo", async () => {
      await withRecommendation();

      expect(button("Save follow-up").disabled).toBe(true);
      typeInto(fields()[1], "Mejoró");
      expect(button("Save follow-up").disabled).toBe(true);
      typeInto(fields()[0], "Hablé con el estudiante");
      expect(button("Save follow-up").disabled).toBe(false);
    });

    it("guarda la acción y el resultado, y limpia el formulario", async () => {
      await withRecommendation();
      typeInto(fields()[0], "  Hablé con el estudiante  ");
      typeInto(fields()[1], "Entregó la tarea pendiente");

      root()
        .querySelector("form")
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(text()).toContain("Follow-up saved."));

      const post = backend.calls.find((call) => call.path.endsWith("/followups"));
      expect(post.path).toBe(`/recommendations/${RECOMMENDATION.id}/followups`);
      expect(post.json).toEqual({
        actionTaken: "Hablé con el estudiante",
        observedResult: "Entregó la tarea pendiente",
      });
      expect(fields()[0].value).toBe("");
    });

    it("un resultado vacío se envía como null", async () => {
      await withRecommendation();
      typeInto(fields()[0], "Tutoría");

      root()
        .querySelector("form")
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(text()).toContain("Follow-up saved."));

      expect(backend.calls.find((call) => call.path.endsWith("/followups")).json).toEqual({
        actionTaken: "Tutoría",
        observedResult: null,
      });
    });
  });
});
