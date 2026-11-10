import { describe, expect, it } from "vitest";
import {
  applyEvent,
  canSend,
  cleanMessage,
  closeTurn,
  codeFromError,
  emptyConversation,
  errorKind,
  failTurn,
  fromHistory,
  MAX_MESSAGE_LENGTH,
  sourceUrl,
  startTurn,
  toChatRequest,
  toolLabel,
} from "../../../moodle/local/ai_assistant/amd/src/chat_model.js";
import { parseEvents, readEvents } from "../../../moodle/local/ai_assistant/amd/src/sse.js";

const ev = (event, data) => ({ event, data: JSON.stringify(data) });
const asked = () => startTurn(emptyConversation(), "  ¿Quién no entregó?  ");
const last = (conversation) => conversation.messages.at(-1);

describe("lector de eventos SSE", () => {
  it("separa eventos completos y conserva el resto sin terminar", () => {
    const { events, rest } = parseEvents(
      'event: token\ndata: {"text":"Ho"}\n\nevent: token\ndata: {"te',
    );

    expect(events).toEqual([{ event: "token", data: '{"text":"Ho"}' }]);
    expect(rest).toBe('event: token\ndata: {"te');
  });

  it("acepta CRLF, comentarios, varias líneas data y eventos sin nombre", () => {
    const { events } = parseEvents(
      ": latido\r\n\r\ndata: uno\r\ndata: dos\r\n\r\nevent: final\r\ndata: {}\r\n\r\n",
    );

    expect(events).toEqual([
      { event: "message", data: "uno\ndos" },
      { event: "final", data: "{}" },
    ]);
  });

  it("un bloque sin datos ni nombre no genera evento", () => {
    expect(parseEvents(": solo comentario\n\n").events).toEqual([]);
  });

  it("lee un flujo real por trozos, aunque un evento llegue partido", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'event: token\ndata: {"text":"Ho',
      'la"}\n\nevent: fin',
      'al\ndata: {"answer":"Hola"}\n\n',
    ];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const received = [];

    await readEvents(new Response(stream), (event) => received.push(event));

    expect(received).toEqual([
      { event: "token", data: '{"text":"Hola"}' },
      { event: "final", data: '{"answer":"Hola"}' },
    ]);
  });

  it("un carácter multibyte partido entre dos trozos no se corrompe", async () => {
    const bytes = new TextEncoder().encode('event: token\ndata: {"text":"ñ"}\n\n');
    const cut = bytes.indexOf(0xc3) + 1;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });
    const received = [];

    await readEvents(new Response(stream), (event) => received.push(event));

    expect(JSON.parse(received[0].data).text).toBe("ñ");
  });

  it("un evento final sin línea en blanco al cerrar el flujo se entrega igual", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: final\ndata: {"answer":"x"}'));
        controller.close();
      },
    });
    const received = [];

    await readEvents(new Response(stream), (event) => received.push(event));

    expect(received).toEqual([{ event: "final", data: '{"answer":"x"}' }]);
  });
});

describe("mensaje del docente", () => {
  it("se limpia y se valida su longitud", () => {
    expect(cleanMessage("  hola  ")).toBe("hola");
    expect(canSend("   ")).toBe(false);
    expect(canSend("hola")).toBe(true);
    expect(canSend("x".repeat(MAX_MESSAGE_LENGTH))).toBe(true);
    expect(canSend("x".repeat(MAX_MESSAGE_LENGTH + 1))).toBe(false);
  });

  it("la petición lleva el curso, la conversación y el texto limpio", () => {
    expect(toChatRequest({ conversationId: "c-1" }, 7, "  hola ")).toEqual({
      courseId: 7,
      conversationId: "c-1",
      message: "hola",
    });
    expect(toChatRequest(emptyConversation(), 7, "hola").conversationId).toBeNull();
  });
});

describe("conversación", () => {
  it("un turno agrega la pregunta y una respuesta vacía en curso, sin modificar la original", () => {
    const original = emptyConversation();

    const conversation = startTurn(original, "  ¿Quién no entregó?  ");

    expect(original.messages).toEqual([]);
    expect(conversation.messages[0]).toMatchObject({ role: "user", text: "¿Quién no entregó?" });
    expect(last(conversation)).toMatchObject({
      role: "assistant",
      text: "",
      status: "streaming",
      sources: [],
    });
  });

  it("los tokens se acumulan en la respuesta", () => {
    let conversation = asked();
    conversation = applyEvent(conversation, ev("token", { text: "Tres " }));
    conversation = applyEvent(conversation, ev("token", { text: "estudiantes." }));

    expect(last(conversation)).toMatchObject({ text: "Tres estudiantes.", status: "streaming" });
  });

  it("las herramientas se listan sin repetirse", () => {
    let conversation = asked();
    conversation = applyEvent(conversation, ev("tool", { name: "get_assignment_submissions" }));
    conversation = applyEvent(conversation, ev("tool", { name: "get_assignment_submissions" }));
    conversation = applyEvent(conversation, ev("tool", { name: "get_pending_grading" }));

    expect(last(conversation).tools).toEqual(["get_assignment_submissions", "get_pending_grading"]);
    expect(toolLabel("get_assignment_submissions")).toBe("get assignment submissions");
  });

  it("el evento final reemplaza el texto con la respuesta completa y trae fuentes, fecha y aviso", () => {
    let conversation = asked();
    conversation = applyEvent(conversation, ev("token", { text: "borrador" }));

    conversation = applyEvent(
      conversation,
      ev("final", {
        conversationId: "c-9",
        answer: "Tres estudiantes no entregaron.",
        generatedAt: "2026-11-09T15:00:00Z",
        incompleteData: true,
        sources: [{ type: "moodle_activity", id: 21 }],
      }),
    );

    expect(conversation.conversationId).toBe("c-9");
    expect(last(conversation)).toMatchObject({
      text: "Tres estudiantes no entregaron.",
      status: "done",
      incompleteData: true,
      generatedAt: "2026-11-09T15:00:00Z",
      sources: [{ type: "moodle_activity", id: 21 }],
    });
  });

  it("un final sin fuentes ni aviso no inventa nada", () => {
    const conversation = applyEvent(
      asked(),
      ev("final", { conversationId: "c", answer: "Hola", generatedAt: "2026-11-09T15:00:00Z" }),
    );

    expect(last(conversation)).toMatchObject({ sources: [], incompleteData: false });
  });

  it("un error marca la respuesta como fallida con su código", () => {
    const conversation = applyEvent(
      asked(),
      ev("error", { code: "AI_PROVIDER_UNAVAILABLE", message: "x" }),
    );

    expect(last(conversation)).toMatchObject({
      status: "error",
      errorCode: "AI_PROVIDER_UNAVAILABLE",
    });
  });

  it("ignora eventos mal formados o desconocidos sin romper la conversación", () => {
    const before = asked();

    expect(applyEvent(before, { event: "token", data: "no es json" })).toBe(before);
    expect(applyEvent(before, { event: "token", data: "[1]" })).toBe(before);
    expect(applyEvent(before, ev("token", { texto: "x" }))).toBe(before);
    expect(applyEvent(before, ev("inventado", { a: 1 }))).toBe(before);
  });

  it("si el flujo termina sin evento final, la respuesta queda interrumpida", () => {
    let conversation = applyEvent(asked(), ev("token", { text: "parcial" }));

    conversation = closeTurn(conversation);

    expect(last(conversation)).toMatchObject({
      status: "error",
      errorCode: "STREAM_INTERRUPTED",
      text: "parcial",
    });
  });

  it("cerrar un turno ya terminado no cambia nada", () => {
    const done = applyEvent(asked(), ev("final", { conversationId: "c", answer: "Hola" }));

    expect(closeTurn(done)).toBe(done);
    expect(closeTurn(emptyConversation())).toEqual(emptyConversation());
  });

  it("failTurn conserva el texto parcial", () => {
    const conversation = failTurn(
      applyEvent(asked(), ev("token", { text: "parcial" })),
      "CONNECTION",
    );

    expect(last(conversation)).toMatchObject({ text: "parcial", errorCode: "CONNECTION" });
  });

  it("reconstruye una conversación desde el historial", () => {
    const conversation = fromHistory({
      id: "c-1",
      messages: [
        { role: "user", content: "Hola", createdAt: "2026-11-09T15:00:00Z" },
        { role: "assistant", content: "Buenas", createdAt: "2026-11-09T15:00:02Z" },
      ],
    });

    expect(conversation.conversationId).toBe("c-1");
    expect(conversation.messages.map((m) => [m.role, m.text, m.status])).toEqual([
      ["user", "Hola", "done"],
      ["assistant", "Buenas", "done"],
    ]);
  });
});

describe("errores", () => {
  it("clasifica los códigos y estados", () => {
    expect(errorKind("RATE_LIMITED")).toBe("ratelimited");
    expect(errorKind(undefined, 429)).toBe("ratelimited");
    expect(errorKind("AI_PROVIDER_UNAVAILABLE")).toBe("unavailable");
    expect(errorKind(undefined, 503)).toBe("unavailable");
    expect(errorKind("FORBIDDEN_COURSE")).toBe("forbidden");
    expect(errorKind("STREAM_INTERRUPTED")).toBe("interrupted");
    expect(errorKind("CUALQUIER_COSA")).toBe("other");
  });

  it("deduce el código de un error de red o de HTTP", () => {
    expect(codeFromError({ name: "AbortError" })).toBe("STREAM_INTERRUPTED");
    expect(codeFromError({ status: 429, code: "X" })).toBe("RATE_LIMITED");
    expect(codeFromError({ status: 503 })).toBe("SERVICE_UNAVAILABLE");
    expect(codeFromError({ status: 403 })).toBe("FORBIDDEN");
    expect(codeFromError({ status: 400, code: "VALIDATION_ERROR" })).toBe("VALIDATION_ERROR");
    expect(codeFromError({})).toBe("CONNECTION");
  });
});

describe("fuentes", () => {
  it("enlaza actividades y calificaciones de Moodle; un documento solo si el backend da enlace", () => {
    expect(sourceUrl({ type: "moodle_activity", id: 21 }, "http://moodle.test/", 7)).toBe(
      "http://moodle.test/mod/view.php?id=21",
    );
    expect(sourceUrl({ type: "moodle_gradebook", id: 7 }, "http://moodle.test", 7)).toBe(
      "http://moodle.test/grade/report/grader/index.php?id=7",
    );
    expect(
      sourceUrl({ type: "document", id: "d1", url: null }, "http://moodle.test", 7),
    ).toBeNull();
    expect(
      sourceUrl({ type: "document", id: "d1", url: "https://x.test/d" }, "http://moodle.test", 7),
    ).toBe("https://x.test/d");
  });
});
