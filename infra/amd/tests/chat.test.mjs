// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backend, stream, students } from "./stubs/assistant.mjs";
import { init } from "../../../moodle/local/ai_assistant/amd/src/chat.js";

const ev = (event, data) => ({ event, data: JSON.stringify(data) });
const root = () => document.querySelector('[data-region="chat"]');
const text = () => root().textContent;
const log = () => root().querySelector('[role="log"]');
const input = () => root().querySelector("textarea");
const send = () => root().querySelector('button[type="submit"]');
const button = (label) =>
  [...root().querySelectorAll("button")].find((b) => b.textContent.includes(label));
const type = (value) => {
  input().value = value;
  input().dispatchEvent(new Event("input", { bubbles: true }));
};
const submit = () =>
  root()
    .querySelector("form")
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

const FINAL = {
  conversationId: "11111111-1111-4111-8111-111111111111",
  intent: "submissions",
  answer: "Tres estudiantes no entregaron la tarea 3.",
  generatedAt: "2026-11-09T15:00:00Z",
  sources: [
    { type: "moodle_activity", id: 21 },
    { type: "moodle_gradebook", id: 7 },
    { type: "document", id: "d1", page: 3, url: null },
  ],
  incompleteData: false,
};

/** El backend responde con estos eventos, en orden. */
const answerWith = (events) => {
  stream.calls = [];
  stream.handler = async ({ onEvent }) => {
    for (const event of events) onEvent(event);
  };
};

beforeEach(() => {
  sessionStorage.clear();
  backend.calls = [];
  backend.handler = async () => ({});
  stream.calls = [];
  students.list = [];
  students.fails = false;
  document.body.innerHTML = `
    <div data-region="local_ai_assistant">
      <section class="d-none" data-region="chat"></section>
    </div>`;
});

describe("pantalla del chat", () => {
  it("muestra el título, la explicación y un mensaje de inicio", async () => {
    await init(7);

    expect(root().classList.contains("d-none")).toBe(false);
    expect(text()).toContain("Ask the assistant");
    expect(text()).toContain("does not invent answers");
    expect(text()).toContain("Ask your first question.");
    expect(send().disabled).toBe(true);
    expect(log().getAttribute("aria-live")).toBe("polite");
  });

  it("solo permite enviar un mensaje no vacío y de hasta 2000 caracteres", async () => {
    await init(7);

    type("   ");
    expect(send().disabled).toBe(true);
    type("hola");
    expect(send().disabled).toBe(false);
    expect(input().maxLength).toBe(2000);
  });
});

describe("enviar y recibir", () => {
  it("envía la pregunta con el curso y sin conversación, y muestra la respuesta completa", async () => {
    answerWith([
      ev("tool", { name: "get_assignment_submissions" }),
      ev("token", { text: "Tres " }),
      ev("final", FINAL),
    ]);
    await init(7);

    type("¿Quién no entregó la tarea 3?");
    submit();
    await vi.waitFor(() => expect(text()).toContain("Tres estudiantes no entregaron la tarea 3."));

    expect(stream.calls[0]).toMatchObject({
      path: "/assistant/chat",
      json: { courseId: 7, conversationId: null, message: "¿Quién no entregó la tarea 3?" },
    });
    expect(log().querySelector('[data-role="user"]').textContent).toContain(
      "¿Quién no entregó la tarea 3?",
    );
    expect(input().value).toBe("");
  });

  it("la siguiente pregunta continúa la misma conversación", async () => {
    answerWith([ev("final", FINAL)]);
    await init(7);
    type("primera");
    submit();
    await vi.waitFor(() => expect(text()).toContain("Tres estudiantes"));
    await vi.waitFor(() => expect(input().disabled).toBe(false));

    type("segunda");
    submit();
    await vi.waitFor(() => expect(stream.calls).toHaveLength(2));

    expect(stream.calls[1].json.conversationId).toBe(FINAL.conversationId);
  });

  it("muestra mientras tanto lo que consulta y los tokens que llegan", async () => {
    let finish;
    const gate = new Promise((resolve) => (finish = resolve));
    stream.handler = async ({ onEvent }) => {
      onEvent(ev("tool", { name: "get_pending_grading" }));
      onEvent(ev("token", { text: "Hay " }));
      await gate;
      onEvent(ev("final", FINAL));
    };
    await init(7);

    type("pendientes");
    submit();
    await vi.waitFor(() => expect(text()).toContain("Hay"));

    expect(text()).toContain("Consulting: get pending grading");
    expect(button("Stop").classList.contains("d-none")).toBe(false);
    expect(send().disabled).toBe(true);
    expect(input().disabled).toBe(true);
    finish();
    await vi.waitFor(() => expect(text()).toContain("Tres estudiantes"));
    expect(button("Stop").classList.contains("d-none")).toBe(true);
    expect(input().disabled).toBe(false);
  });

  it("al terminar enseña la fecha de la consulta y las fuentes, con enlaces a Moodle", async () => {
    answerWith([ev("final", FINAL)]);
    await init(7);
    type("pregunta");
    submit();
    await vi.waitFor(() => expect(text()).toContain("Sources:"));

    expect(text()).toContain("Consulted on");
    expect(text()).toContain("Moodle activity 21");
    expect(text()).toContain("Moodle gradebook");
    expect(text()).toContain("Course document, page 3");
    expect([...log().querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "http://moodle.test/mod/view.php?id=21",
      "http://moodle.test/grade/report/grader/index.php?id=7",
    ]);
    expect([...log().querySelectorAll("a")].every((a) => a.rel.includes("noopener"))).toBe(true);
  });

  it("avisa cuando faltaron datos", async () => {
    answerWith([ev("final", { ...FINAL, incompleteData: true })]);
    await init(7);
    type("pregunta");
    submit();

    await vi.waitFor(() =>
      expect(text()).toContain("Some data was missing, so this answer may be incomplete."),
    );
  });

  it("muestra la respuesta como texto, nunca como HTML", async () => {
    answerWith([ev("final", { ...FINAL, answer: '<img src=x onerror="alert(1)"> **negrita**' })]);
    await init(7);
    type("pregunta");
    submit();
    await vi.waitFor(() => expect(text()).toContain("<img src=x"));

    expect(log().querySelector("img")).toBeNull();
    expect(text()).toContain("**negrita**");
  });

  it("Enter envía y Shift+Enter no", async () => {
    answerWith([ev("final", FINAL)]);
    await init(7);
    type("hola");

    input().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(stream.calls).toHaveLength(0);
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(stream.calls).toHaveLength(1));
  });

  it("un doble envío seguido no manda dos preguntas", async () => {
    let finish;
    const gate = new Promise((resolve) => (finish = resolve));
    stream.handler = async ({ onEvent }) => {
      await gate;
      onEvent(ev("final", FINAL));
    };
    await init(7);
    type("hola");

    submit();
    submit();
    finish();
    await vi.waitFor(() => expect(text()).toContain("Tres estudiantes"));

    expect(stream.calls).toHaveLength(1);
  });
});

describe("cuando algo falla", () => {
  const fails = (error) => {
    stream.calls = [];
    stream.handler = async () => {
      throw Object.assign(new Error("x"), error);
    };
  };

  it("proveedor de IA caído: lo dice y no inventa respuesta", async () => {
    fails({ status: 503, code: "AI_PROVIDER_UNAVAILABLE" });
    await init(7);
    type("pregunta");
    submit();

    await vi.waitFor(() => expect(log().querySelector('[role="alert"]')).not.toBeNull());

    expect(log().querySelector('[role="alert"]').textContent).toContain("No answer was generated");
    expect(
      log().querySelector('[data-role="assistant"]').querySelector("div:nth-child(2)").textContent,
    ).toBe("");
  });

  it("límite de uso alcanzado", async () => {
    fails({ status: 429, code: "RATE_LIMITED" });
    await init(7);
    type("pregunta");
    submit();

    await vi.waitFor(() => expect(text()).toContain("You have reached the usage limit."));
  });

  it("sin permiso", async () => {
    fails({ status: 403, code: "FORBIDDEN_CAPABILITY" });
    await init(7);
    type("pregunta");
    submit();

    await vi.waitFor(() =>
      expect(text()).toContain("You do not have permission to use the assistant"),
    );
  });

  it("error desconocido: muestra el código", async () => {
    fails({ code: "ALGO_RARO" });
    await init(7);
    type("pregunta");
    submit();

    await vi.waitFor(() => expect(text()).toContain("The assistant could not answer (ALGO_RARO)."));
  });

  it("error dentro del flujo", async () => {
    answerWith([
      ev("token", { text: "Hay " }),
      ev("error", { code: "AI_PROVIDER_UNAVAILABLE", message: "x" }),
    ]);
    await init(7);
    type("pregunta");
    submit();

    await vi.waitFor(() => expect(text()).toContain("The AI service is not available right now."));
  });

  it("si el flujo se corta sin evento final, avisa que la respuesta puede estar incompleta", async () => {
    answerWith([ev("token", { text: "Hay tres" })]);
    await init(7);
    type("pregunta");
    submit();

    await vi.waitFor(() =>
      expect(text()).toContain("The answer was interrupted and may be incomplete."),
    );
    expect(text()).toContain("Hay tres");
  });

  it("Detener cancela la respuesta en curso y queda marcada como interrumpida", async () => {
    stream.handler = ({ signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("abort"), { name: "AbortError" })),
        );
      });
    await init(7);
    type("pregunta");
    submit();
    await vi.waitFor(() => expect(button("Stop").classList.contains("d-none")).toBe(false));

    button("Stop").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => expect(text()).toContain("The answer was interrupted"));

    expect(input().disabled).toBe(false);
  });

  it("después de un error se puede volver a preguntar", async () => {
    fails({ status: 503 });
    await init(7);
    type("uno");
    submit();
    await vi.waitFor(() => expect(text()).toContain("not available"));

    answerWith([ev("final", FINAL)]);
    type("dos");
    submit();

    await vi.waitFor(() => expect(text()).toContain("Tres estudiantes"));
  });
});

describe("conversaciones", () => {
  it("Nueva conversación vacía el historial y olvida el id", async () => {
    answerWith([ev("final", FINAL)]);
    await init(7);
    type("pregunta");
    submit();
    await vi.waitFor(() => expect(text()).toContain("Tres estudiantes"));
    await vi.waitFor(() => expect(input().disabled).toBe(false));
    expect(sessionStorage.getItem("local_ai_assistant_chat_7")).toBe(FINAL.conversationId);

    button("New conversation").dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(text()).toContain("Ask your first question.");
    expect(sessionStorage.getItem("local_ai_assistant_chat_7")).toBeNull();
    answerWith([ev("final", FINAL)]);
    type("otra");
    submit();
    await vi.waitFor(() => expect(stream.calls).toHaveLength(1));
    expect(stream.calls[0].json.conversationId).toBeNull();
  });

  it("al recargar la página recupera la conversación de esta pestaña", async () => {
    sessionStorage.setItem("local_ai_assistant_chat_7", FINAL.conversationId);
    backend.handler = async (call) => {
      expect(call.path).toBe(`/assistant/conversations/${FINAL.conversationId}`);
      return {
        id: FINAL.conversationId,
        courseId: 7,
        messages: [
          { role: "user", content: "Hola", createdAt: "2026-11-09T15:00:00Z" },
          {
            role: "assistant",
            content: "Buenas, ¿en qué te ayudo?",
            createdAt: "2026-11-09T15:00:02Z",
          },
        ],
      };
    };

    await init(7);

    expect(text()).toContain("Buenas, ¿en qué te ayudo?");
  });

  it("si la conversación recordada ya no existe, la olvida y lo avisa", async () => {
    sessionStorage.setItem("local_ai_assistant_chat_7", FINAL.conversationId);
    backend.handler = async () => {
      throw Object.assign(new Error("x"), { status: 404 });
    };

    await init(7);

    expect(text()).toContain("The previous conversation could not be loaded.");
    expect(sessionStorage.getItem("local_ai_assistant_chat_7")).toBeNull();
  });

  it("cada curso recuerda su propia conversación", async () => {
    sessionStorage.setItem("local_ai_assistant_chat_8", FINAL.conversationId);

    await init(7);

    expect(backend.calls).toHaveLength(0);
  });
});

describe("nombres reales en las respuestas (ADR-010)", () => {
  const A = "Estudiante#00000003";
  const B = "Estudiante#00000005";
  const withStudents = (answer, list) =>
    answerWith([ev("final", { ...FINAL, answer, data: { students: list } })]);
  const ask = async () => {
    await init(7);
    type("¿quién no entregó?");
    submit();
  };

  it("cambia cada seudónimo por el nombre que da Moodle, sin mandar nombres al backend", async () => {
    students.list = [
      { id: 3, fullname: "Carla Cedeño" },
      { id: 5, fullname: "Andrés Álvarez" },
    ];
    withStudents(`${A} y ${B} no entregaron. ${A} tiene dos pendientes.`, [
      { alias: A, studentId: 3 },
      { alias: B, studentId: 5 },
    ]);

    await ask();

    await vi.waitFor(() =>
      expect(text()).toContain("Carla Cedeño y Andrés Álvarez no entregaron. Carla Cedeño tiene"),
    );
    expect(text()).not.toContain("Estudiante#");
    expect(JSON.stringify(stream.calls[0].json)).not.toContain("Carla");
  });

  it("si Moodle no lista a un estudiante muestra «Student N», nunca el seudónimo", async () => {
    students.list = [{ id: 3, fullname: "Carla Cedeño" }];
    withStudents(`${A} y ${B}`, [
      { alias: A, studentId: 3 },
      { alias: B, studentId: 5 },
    ]);

    await ask();

    await vi.waitFor(() => expect(text()).toContain("Carla Cedeño y Student 5"));
    expect(text()).not.toContain("Estudiante#");
  });

  it("si no se pueden cargar los nombres, muestra «Student N» y lo intenta de nuevo en la siguiente respuesta", async () => {
    students.fails = true;
    withStudents(A, [{ alias: A, studentId: 3 }]);
    await ask();
    await vi.waitFor(() => expect(text()).toContain("Student 3"));
    await vi.waitFor(() => expect(input().disabled).toBe(false));

    students.fails = false;
    students.list = [{ id: 3, fullname: "Carla Cedeño" }];
    type("otra");
    submit();

    await vi.waitFor(() => expect(text()).toContain("Carla Cedeño"));
  });

  it("un nombre con HTML se muestra como texto", async () => {
    students.list = [{ id: 3, fullname: "<img src=x onerror=alert(1)>" }];
    withStudents(A, [{ alias: A, studentId: 3 }]);

    await ask();

    await vi.waitFor(() => expect(text()).toContain("<img src=x onerror=alert(1)>"));
    expect(log().querySelector("img")).toBeNull();
  });
});

describe("errores con datos: 429, 404 y 400", () => {
  const fails = (error) => {
    stream.calls = [];
    stream.handler = async () => {
      throw Object.assign(new Error("x"), error);
    };
  };

  it("429 con Retry-After dice cuántos segundos esperar", async () => {
    fails({ status: 429, code: "RATE_LIMITED", retryAfter: 42 });
    await init(7);
    type("pregunta");
    submit();

    await vi.waitFor(() => expect(text()).toContain("Try again in 42 seconds."));
  });

  it("404 CONVERSATION_NOT_FOUND olvida la conversación y devuelve la pregunta al cuadro", async () => {
    sessionStorage.setItem("local_ai_assistant_chat_7", "11111111-1111-4111-8111-111111111111");
    backend.handler = async () => ({ id: "11111111-1111-4111-8111-111111111111", messages: [] });
    await init(7);
    fails({ status: 404, code: "CONVERSATION_NOT_FOUND" });
    type("mi pregunta");
    submit();

    await vi.waitFor(() => expect(text()).toContain("no longer exists"));

    expect(input().value).toBe("mi pregunta");
    expect(sessionStorage.getItem("local_ai_assistant_chat_7")).toBeNull();
    stream.handler = async ({ onEvent }) => onEvent(ev("final", FINAL));
    submit();
    await vi.waitFor(() => expect(stream.calls.length).toBe(2));
    expect(stream.calls[1].json.conversationId).toBeNull();
  });

  it("400 muestra los campos que se rechazaron", async () => {
    fails({
      status: 400,
      code: "VALIDATION_ERROR",
      details: [{ path: "message", message: "Demasiado largo" }],
    });
    await init(7);
    type("pregunta");
    submit();

    await vi.waitFor(() => expect(text()).toContain("The message was not accepted"));
    expect(text()).toContain("message: Demasiado largo");
  });
});

describe("criterio aplicado y aclaración", () => {
  it("muestra el criterio aplicado como una lista desplegable bajo la respuesta", async () => {
    answerWith([
      ev("final", {
        ...FINAL,
        criteria: ["Un borrador no cuenta como entrega.", "Tarde es después del plazo."],
      }),
    ]);
    await init(7);
    type("pregunta");
    submit();

    await vi.waitFor(() => expect(log().querySelector("details")).not.toBeNull());

    const details = log().querySelector("details");
    expect(details.querySelector("summary").textContent).toBe("Criteria applied");
    expect([...details.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "Un borrador no cuenta como entrega.",
      "Tarde es después del plazo.",
    ]);
  });

  it("sin criterios no dibuja nada", async () => {
    answerWith([ev("final", { ...FINAL, criteria: [] })]);
    await init(7);
    type("pregunta");
    submit();

    await vi.waitFor(() => expect(text()).toContain("Tres estudiantes no entregaron"));

    expect(log().querySelector("details")).toBeNull();
  });

  it("una pregunta de aclaración se muestra como una respuesta más, sin fuentes ni criterio", async () => {
    answerWith([
      ev("final", {
        ...FINAL,
        intent: "clarification",
        answer: "¿De qué tarea hablas? Dime su número o su nombre.",
        sources: [],
        criteria: [],
      }),
    ]);
    await init(7);
    type("¿quién no entregó la tarea?");
    submit();

    await vi.waitFor(() => expect(text()).toContain("¿De qué tarea hablas?"));

    expect(log().querySelector("details")).toBeNull();
    expect(text()).not.toContain("Sources:");
  });

  it("el criterio no se interpreta como HTML", async () => {
    answerWith([ev("final", { ...FINAL, criteria: ["<img src=x onerror=alert(1)>"] })]);
    await init(7);
    type("pregunta");
    submit();

    await vi.waitFor(() => expect(log().querySelector("details")).not.toBeNull());

    expect(log().querySelector("details img")).toBeNull();
    expect(log().querySelector("details").textContent).toContain("<img src=x");
  });
});
