import { z } from "zod";
import { LlmService } from "../llm/llm.service";
import { MockLlmProvider } from "../llm/providers/mock-llm.provider";
import { Pseudonymizer } from "../privacy/pseudonymizer";
import {
  AiOrchestratorService,
  ASSISTANT_SYSTEM_PROMPT,
  CLARIFICATION_INTENT,
  CLARIFICATION_TOOL,
} from "./ai-orchestrator.service";
import { ToolRegistry, type AssistantTool, type ToolOutput } from "./tools/assistant-tool";

const SECRET = "una-clave-de-prueba-de-al-menos-32-caracteres";
const LIMITS = { maxInputTokens: 32_000, maxOutputTokens: 8_192, timeoutMs: 5_000 };
const AUTH = { moodleUserId: 42, courseId: 7 };

const tool = (
  name: string,
  output: ToolOutput,
  requires?: "viewanalytics",
): AssistantTool<Record<string, never>> => ({
  name,
  description: `Herramienta ${name}`,
  kind: "read",
  input: z.object({}),
  requires,
  execute: async () => output,
});

function setup(tools: AssistantTool[]) {
  const provider = new MockLlmProvider();
  const llm = new LlmService(provider, { record: () => undefined }, LIMITS);
  const service = new AiOrchestratorService(llm, new ToolRegistry(tools));
  const run = (
    options: { canAskClarification?: boolean; auth?: typeof AUTH & { capabilities?: object } } = {},
  ) =>
    service.run({
      auth: (options.auth ?? AUTH) as never,
      history: [],
      message: "¿Quién no entregó la tarea?",
      canAskClarification: options.canAskClarification,
      pseudonymizer: new Pseudonymizer(SECRET, 7),
    });
  return { provider, run };
}

const ask = (question: unknown) => ({
  kind: "tool_calls" as const,
  calls: [{ id: "c1", name: CLARIFICATION_TOOL, arguments: { question } }],
});

describe("aclaración única", () => {
  it("el modelo la conoce: se ofrece como herramienta y el prompt dice que es una sola vez", async () => {
    const { provider, run } = setup([]);
    provider.respondToChatWith(() => ({ kind: "text", text: "Hola" }));

    await run();

    expect(provider.chatCalls[0]!.tools.map((t) => t.name)).toEqual([CLARIFICATION_TOOL]);
    expect(ASSISTANT_SYSTEM_PROMPT).toContain(CLARIFICATION_TOOL);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/UNA sola vez/);
  });

  it("al pedirla, el turno termina con la pregunta, sin datos ni fuentes, y queda marcado como aclaración", async () => {
    const { provider, run } = setup([]);
    provider.respondToChatWith(() => ask("¿De qué tarea hablas? Dime su número o su nombre."));

    const result = await run();

    expect(result).toMatchObject({
      answer: "¿De qué tarea hablas? Dime su número o su nombre.",
      intent: CLARIFICATION_INTENT,
      data: null,
      sources: [],
      criteria: [],
      incompleteData: false,
      toolsUsed: [],
    });
    expect(provider.chatCalls).toHaveLength(1);
  });

  it("si lo último que dijo el asistente fue una aclaración, ya no se ofrece la herramienta", async () => {
    const { provider, run } = setup([]);
    provider.respondToChatWith(() => ({ kind: "text", text: "Con lo que tengo: nadie." }));

    await run({ canAskClarification: false });

    expect(provider.chatCalls[0]!.tools).toEqual([]);
  });

  it("si el modelo insiste en preguntar de nuevo, no se le hace caso: no sale otra aclaración", async () => {
    const { provider, run } = setup([]);
    provider.respondToChatWith((_request, turn) =>
      turn === 0
        ? ask("¿Cuál tarea?")
        : { kind: "text", text: "No encontré datos para responder." },
    );

    const result = await run({ canAskClarification: false });

    expect(result.intent).not.toBe(CLARIFICATION_INTENT);
    expect(result.answer).toBe("No encontré datos para responder.");
    expect(result.incompleteData).toBe(true);
  });

  it.each([undefined, "", "  ", "ab", 42, null])(
    "una aclaración mal formada (%j) no termina el turno",
    async (question) => {
      const { provider, run } = setup([]);
      provider.respondToChatWith((_request, turn) =>
        turn === 0 ? ask(question) : { kind: "text", text: "Respuesta normal." },
      );

      const result = await run();

      expect(result.intent).not.toBe(CLARIFICATION_INTENT);
      expect(result.answer).toBe("Respuesta normal.");
    },
  );

  it("una aclaración que menciona un seudónimo que ninguna herramienta entregó no lo muestra", async () => {
    const { provider, run } = setup([]);
    provider.respondToChatWith(() => ask("¿Te refieres a Estudiante#12345678 o a otra persona?"));

    const result = await run();

    expect(result.answer).not.toContain("Estudiante#12345678");
    expect(result.incompleteData).toBe(true);
  });
});

describe("criterio aplicado", () => {
  it("junta, sin repetir, las reglas de las herramientas que se usaron", async () => {
    const a = tool("a", { data: {}, sources: [], criteria: ["Regla 1", "Regla 2"] });
    const b = tool("b", { data: {}, sources: [], criteria: ["Regla 2", "Regla 3"] });
    const { provider, run } = setup([a, b]);
    provider.respondToChatWith((_request, turn) =>
      turn === 0
        ? {
            kind: "tool_calls",
            calls: [
              { id: "1", name: "a", arguments: {} },
              { id: "2", name: "b", arguments: {} },
            ],
          }
        : { kind: "text", text: "Listo." },
    );

    const result = await run();

    expect(result.criteria).toEqual(["Regla 1", "Regla 2", "Regla 3"]);
  });

  it("una herramienta que falla no aporta su criterio", async () => {
    const failing: AssistantTool = {
      ...tool("falla", { data: {}, sources: [], criteria: ["No debe salir"] }),
      execute: async () => {
        throw new Error("Moodle no respondió");
      },
    };
    const { provider, run } = setup([failing]);
    provider.respondToChatWith((_request, turn) =>
      turn === 0
        ? { kind: "tool_calls", calls: [{ id: "1", name: "falla", arguments: {} }] }
        : { kind: "text", text: "No pude consultarlo." },
    );

    const result = await run();

    expect(result.criteria).toEqual([]);
    expect(result.incompleteData).toBe(true);
  });

  it("sin herramientas no hay criterio", async () => {
    const { provider, run } = setup([]);
    provider.respondToChatWith(() => ({ kind: "text", text: "Hola" }));

    expect((await run()).criteria).toEqual([]);
  });
});

describe("herramientas que exigen viewanalytics (RF-02)", () => {
  const evidence = tool(
    "get_student_learning_evidence",
    { data: { ok: true }, sources: [] },
    "viewanalytics",
  );

  it("se ofrecen solo al docente que tiene la capacidad", async () => {
    const withCapability = setup([evidence]);
    withCapability.provider.respondToChatWith(() => ({ kind: "text", text: "." }));
    await withCapability.run({
      auth: { ...AUTH, capabilities: { use: true, viewanalytics: true } },
    });
    const without = setup([evidence]);
    without.provider.respondToChatWith(() => ({ kind: "text", text: "." }));
    await without.run({ auth: { ...AUTH, capabilities: { use: true, viewanalytics: false } } });

    expect(withCapability.provider.chatCalls[0]!.tools.map((t) => t.name)).toContain(
      "get_student_learning_evidence",
    );
    expect(without.provider.chatCalls[0]!.tools.map((t) => t.name)).not.toContain(
      "get_student_learning_evidence",
    );
  });

  it("si un modelo la pide sin tener permiso, no se ejecuta y el dato no llega", async () => {
    const execute = jest.fn(async () => ({ data: { secreto: 1 }, sources: [] }));
    const guarded: AssistantTool = { ...evidence, execute };
    const { provider, run } = setup([guarded]);
    provider.respondToChatWith((_request, turn) =>
      turn === 0
        ? {
            kind: "tool_calls",
            calls: [{ id: "1", name: "get_student_learning_evidence", arguments: {} }],
          }
        : { kind: "text", text: "No pude consultarlo." },
    );

    const result = await run({
      auth: { ...AUTH, capabilities: { use: true, viewanalytics: false } },
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.data).toBeNull();
    expect(result.incompleteData).toBe(true);
  });
});
