import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSyllabusExtraction, syllabusExtractionSchema } from "@smart-lms/contracts";
import { createMockApi, MOCK_SYLLABUS_ID } from "../../mocks/ai-api.mjs";
import { parseEvents, readEvents } from "../../../moodle/local/ai_assistant/amd/src/sse.js";

/**
 * Pruebas del simulador de la API de IA: son también la referencia de lo que debe cumplir la
 * implementación real (formato de eventos SSE, códigos de error, esquema v1 de la extracción).
 */
let server;
let base;
const token = `x.${Buffer.from(JSON.stringify({ sub: "4", courseid: 7 })).toString("base64url")}.y`;

const call = (method, path, body, headers = {}) =>
  fetch(`${base}/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });

beforeAll(async () => {
  server = createMockApi({ delayMs: 5 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

describe("sesión y errores", () => {
  it("lee la identidad del token y concede las capacidades", async () => {
    const body = await (await call("GET", "/session")).json();

    expect(body).toMatchObject({
      moodleUserId: 4,
      courseId: 7,
      capabilities: { use: true, publish: true, viewanalytics: true },
    });
  });

  it("permite el acceso desde el navegador (CORS) con las cabeceras del plugin", async () => {
    const res = await fetch(`${base}/api/v1/session`, { method: "OPTIONS" });

    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-headers")).toContain("Idempotency-Key");
  });

  it("una ruta que no simula responde con el formato de error del contrato", async () => {
    const res = await call("GET", "/proposals/x");

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("extracción (Sprint 5)", () => {
  it("el sílabo pasa de TEXT_READY a EXTRACTED y la extracción cumple el esquema v1", async () => {
    expect((await (await call("GET", `/syllabi/${MOCK_SYLLABUS_ID}`)).json()).status).toBe(
      "TEXT_READY",
    );

    expect((await call("POST", `/syllabi/${MOCK_SYLLABUS_ID}/extract`)).status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect((await (await call("GET", `/syllabi/${MOCK_SYLLABUS_ID}`)).json()).status).toBe(
      "EXTRACTED",
    );
    const version = await (await call("GET", `/syllabi/${MOCK_SYLLABUS_ID}/extraction`)).json();
    expect(version).toMatchObject({ version: 1, schemaVersion: "1.0", source: "AI" });
    expect(syllabusExtractionSchema.safeParse(version.content).success).toBe(true);
    expect(Array.isArray(version.consistencyIssues)).toBe(true);
  });

  it("no se puede extraer dos veces", async () => {
    expect((await call("POST", `/syllabi/${MOCK_SYLLABUS_ID}/extract`)).status).toBe(409);
  });

  it("guardar la revisión crea una versión del docente y deja el sílabo REVIEWED", async () => {
    const content = buildSyllabusExtraction({
      course: { ...buildSyllabusExtraction().course, name: "Corregido" },
    });

    const res = await call("PUT", `/syllabi/${MOCK_SYLLABUS_ID}/extraction`, content);

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      version: 2,
      source: "TEACHER",
      content: { course: { name: "Corregido" } },
    });
    expect((await (await call("GET", `/syllabi/${MOCK_SYLLABUS_ID}`)).json()).status).toBe(
      "REVIEWED",
    );
    expect(
      (await (await call("GET", `/syllabi/${MOCK_SYLLABUS_ID}/extraction?version=1`)).json())
        .source,
    ).toBe("AI");
  });

  it("una extracción que no cumple el esquema responde 400 con el detalle", async () => {
    const res = await call("PUT", `/syllabi/${MOCK_SYLLABUS_ID}/extraction`, {
      schemaVersion: "1.0",
    });

    expect(res.status).toBe(400);
    expect((await res.json()).details.length).toBeGreaterThan(0);
  });

  it("un sílabo que no existe responde 404", async () => {
    expect((await call("GET", "/syllabi/00000000-0000-4000-8000-00000000ffff")).status).toBe(404);
  });
});

describe("chat (Sprints 8 y 9)", () => {
  it("con Accept text/event-stream emite tool, token y final, en ese orden", async () => {
    const res = await call(
      "POST",
      "/assistant/chat",
      { courseId: 7, conversationId: null, message: "¿Quién no entregó?" },
      { Accept: "text/event-stream" },
    );
    const events = [];

    await readEvents(res, (event) => events.push(event));

    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const names = events.map((event) => event.event);
    expect(names[0]).toBe("tool");
    expect(names.at(-1)).toBe("final");
    expect(names.slice(1, -1).every((name) => name === "token")).toBe(true);
    expect(JSON.parse(events[0].data)).toEqual({ name: "get_assignment_submissions" });
    const final = JSON.parse(events.at(-1).data);
    expect(final).toMatchObject({
      answer: expect.any(String),
      sources: expect.any(Array),
      incompleteData: false,
    });
    expect(final.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    const streamed = events
      .filter((e) => e.event === "token")
      .map((e) => JSON.parse(e.data).text)
      .join("");
    expect(streamed.trim()).toBe(final.answer);
  });

  it("los eventos se pueden leer con el lector del plugin aunque lleguen partidos", () => {
    const { events } = parseEvents('event: token\ndata: {"text":"a"}\n\n');

    expect(events).toEqual([{ event: "token", data: '{"text":"a"}' }]);
  });

  it("con Accept application/json devuelve la respuesta completa", async () => {
    const res = await call(
      "POST",
      "/assistant/chat",
      { courseId: 7, message: "hola" },
      { Accept: "application/json" },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      answer: expect.any(String),
      generatedAt: expect.any(String),
    });
  });

  it("guarda la conversación y devuelve su historial", async () => {
    const first = await (
      await call(
        "POST",
        "/assistant/chat",
        { courseId: 7, message: "primera" },
        { Accept: "application/json" },
      )
    ).json();
    await call(
      "POST",
      "/assistant/chat",
      { courseId: 7, conversationId: first.conversationId, message: "segunda" },
      { Accept: "application/json" },
    );

    const history = await (
      await call("GET", `/assistant/conversations/${first.conversationId}`)
    ).json();

    expect(history.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect((await call("GET", "/assistant/conversations/no-existe")).status).toBe(404);
  });

  it("simula el límite de uso, el proveedor caído y los datos incompletos", async () => {
    expect(
      (await call("POST", "/assistant/chat", { courseId: 7, message: "pasé el límite" })).status,
    ).toBe(429);
    const down = await call("POST", "/assistant/chat", { courseId: 7, message: "servicio caído" });
    expect(down.status).toBe(503);
    expect((await down.json()).code).toBe("AI_PROVIDER_UNAVAILABLE");
    const incomplete = await (
      await call(
        "POST",
        "/assistant/chat",
        { courseId: 7, message: "dato incompleto" },
        { Accept: "application/json" },
      )
    ).json();
    expect(incomplete.incompleteData).toBe(true);
  });

  it("un mensaje vacío responde 400 con details", async () => {
    const res = await call("POST", "/assistant/chat", { courseId: 7, message: "  " });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      details: [{ path: "message", message: expect.any(String) }],
    });
  });

  it("la respuesta nombra a los estudiantes con seudónimos y los explica en data.students", async () => {
    const res = await call(
      "POST",
      "/assistant/chat",
      { courseId: 7, message: "hola" },
      { Accept: "application/json" },
    );
    const body = await res.json();

    expect(body.data.students).toEqual([
      { alias: "Estudiante#00000003", studentId: 3 },
      { alias: "Estudiante#00000005", studentId: 5 },
      { alias: "Estudiante#00000006", studentId: 6 },
    ]);
    for (const { alias } of body.data.students) expect(body.answer).toContain(alias);
  });

  it("el 429 trae Retry-After y el navegador puede leerlo", async () => {
    const res = await call("POST", "/assistant/chat", { courseId: 7, message: "pasé el límite" });

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(res.headers.get("access-control-expose-headers")).toContain("Retry-After");
  });

  it("una conversación que el simulador no conoce responde 404 CONVERSATION_NOT_FOUND", async () => {
    const res = await call("POST", "/assistant/chat", {
      courseId: 7,
      conversationId: "99999999-9999-4999-8999-999999999999",
      message: "hola",
    });

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("CONVERSATION_NOT_FOUND");
  });
});

describe("analítica (Sprints 10 y 11)", () => {
  it("devuelve indicadores (uno sin dato) y señales con explicación", async () => {
    const analytics = await (await call("GET", "/analytics/courses/7")).json();

    expect(analytics.courseId).toBe(7);
    expect(analytics.indicators.every((i) => i.key && i.label && i.definition)).toBe(true);
    expect(analytics.indicators.some((i) => i.value === null)).toBe(true);
    expect(
      analytics.signals.every((s) => Number.isInteger(s.studentId) && s.rule && s.explanation),
    ).toBe(true);
  });

  it("separa lo observado, lo calculado y lo que falta", async () => {
    const evidence = await (await call("GET", "/analytics/courses/7/students/3")).json();

    expect(evidence).toMatchObject({ courseId: 7, studentId: 3 });
    expect(evidence.observed.length).toBeGreaterThan(0);
    expect(evidence.computed.length).toBeGreaterThan(0);
    expect(evidence.unknown.length).toBeGreaterThan(0);
  });

  it("genera una recomendación con evidencias y limitaciones, y responde 422 si faltan datos", async () => {
    const res = await call("POST", "/analytics/courses/7/students/3/recommendations");

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      id: expect.any(String),
      evidenceSummary: expect.any(Array),
      missingInformation: expect.any(Array),
      strategies: expect.any(Array),
      followUpIndicators: expect.any(Array),
    });
    expect((await call("POST", "/analytics/courses/7/students/99/recommendations")).status).toBe(
      422,
    );
  });

  it("registra el seguimiento y exige la acción", async () => {
    expect(
      (
        await call("POST", "/recommendations/11111111-1111-4111-8111-111111111111/followups", {
          actionTaken: "Tutoría",
          observedResult: null,
        })
      ).status,
    ).toBe(201);
    expect(
      (await call("POST", "/recommendations/11111111-1111-4111-8111-111111111111/followups", {}))
        .status,
    ).toBe(400);
  });
});

describe("administración (CU-06 y CU-07)", () => {
  it("la sesión del simulador incluye admin", async () => {
    expect((await (await call("GET", "/session")).json()).capabilities.admin).toBe(true);
  });

  it("pagina la auditoría sin repetir eventos y filtra", async () => {
    const first = await (await call("GET", "/audit?limit=50")).json();
    const second = await (await call("GET", `/audit?limit=50&cursor=${first.nextCursor}`)).json();
    const denied = await (await call("GET", "/audit?outcome=DENIED&limit=200")).json();
    const domain = await (await call("GET", "/audit?action=proposal.&limit=200")).json();

    expect(first.items).toHaveLength(50);
    expect(second.items[0].id).not.toBe(first.items.at(-1).id);
    expect(denied.items.every((e) => e.outcome === "DENIED")).toBe(true);
    expect(domain.items.every((e) => e.action.startsWith("proposal."))).toBe(true);
    expect((await call("GET", "/audit?limit=0")).status).toBe(400);
  });

  it("guarda, lee y quita una regla con el alcance correcto", async () => {
    const put = await call("PUT", "/admin/difficulty-rules/SUSTAINED_DECLINE", {
      courseId: 7,
      enabled: false,
      params: { consecutive: 4 },
    });
    const forCourse = await (await call("GET", "/admin/difficulty-rules?courseId=7")).json();
    const institution = await (await call("GET", "/admin/difficulty-rules")).json();
    const rule = (body) => body.rules.find((r) => r.rule === "SUSTAINED_DECLINE");

    expect(put.status).toBe(200);
    expect(rule(forCourse)).toMatchObject({
      scope: "course",
      enabled: false,
      params: { consecutive: 4 },
    });
    expect(rule(institution)).toMatchObject({ scope: "default", enabled: true });
    expect(
      (await call("DELETE", "/admin/difficulty-rules/SUSTAINED_DECLINE?courseId=7")).status,
    ).toBe(204);
    expect(
      (await call("DELETE", "/admin/difficulty-rules/SUSTAINED_DECLINE?courseId=7")).status,
    ).toBe(404);
  });

  it("rechaza una regla inexistente y un cuerpo inválido", async () => {
    expect((await call("PUT", "/admin/difficulty-rules/INVENTADA", {})).status).toBe(404);
    const bad = await call("PUT", "/admin/difficulty-rules/MISSING_REQUIRED", {
      courseId: null,
      enabled: true,
      params: { otra: 1 },
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).details).toEqual(expect.any(Array));
  });
});
