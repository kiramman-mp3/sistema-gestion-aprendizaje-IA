import { z } from "zod";
import { LlmError } from "./llm.errors";
import { LlmProvider, type LlmProviderRequest } from "./llm-provider";
import type { LlmUsageEntry, LlmUsageRecorder } from "./llm-usage.recorder";
import { LlmService, type LlmLimits } from "./llm.service";
import { MockLlmProvider } from "./providers/mock-llm.provider";
import { UnavailableLlmProvider } from "./providers/unavailable-llm.provider";

const answerSchema = z.object({ answer: z.string(), score: z.number().nullable() });

const LIMITS: LlmLimits = { maxInputTokens: 100, maxOutputTokens: 500, timeoutMs: 1_000 };

function setup(provider: LlmProvider, limits: LlmLimits = LIMITS) {
  const entries: LlmUsageEntry[] = [];
  const recorder: LlmUsageRecorder = { record: (entry) => entries.push(entry) };
  return { service: new LlmService(provider, recorder, limits), entries };
}

function request(overrides: Partial<Parameters<LlmService["generateStructured"]>[0]> = {}) {
  return {
    purpose: "test",
    system: "Responde en JSON.",
    prompt: "Pregunta",
    schema: answerSchema,
    schemaName: "answer",
    ...overrides,
  };
}

describe("LlmService", () => {
  afterEach(() => jest.useRealTimers());

  it("devuelve la salida validada, el modelo y el consumo", async () => {
    const provider = new MockLlmProvider(() => ({ answer: "hola", score: null }));
    const { service, entries } = setup(provider);

    const result = await service.generateStructured(request());

    expect(result.data).toEqual({ answer: "hola", score: null });
    expect(result.model).toBe("mock-1");
    expect(result.usage.outputTokens).toBeGreaterThan(0);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      purpose: "test",
      provider: "mock",
      model: "mock-1",
      outcome: "ok",
    });
  });

  it("pasa al proveedor el esquema JSON y los topes aplicados", async () => {
    const provider = new MockLlmProvider(() => ({ answer: "x", score: 1 }));
    const { service } = setup(provider);

    await service.generateStructured(request({ maxOutputTokens: 9_999, timeoutMs: 50_000 }));

    const sent = provider.calls[0] as LlmProviderRequest;
    expect(sent.maxOutputTokens).toBe(LIMITS.maxOutputTokens);
    expect(sent.schemaName).toBe("answer");
    expect(sent.jsonSchema).toMatchObject({ type: "object", required: ["answer", "score"] });
  });

  it("permite bajar los topes por petición", async () => {
    const provider = new MockLlmProvider(() => ({ answer: "x", score: 1 }));
    const { service } = setup(provider);

    await service.generateStructured(request({ maxOutputTokens: 100 }));

    expect(provider.calls[0]?.maxOutputTokens).toBe(100);
  });

  it("no llama al proveedor si la entrada supera el tope", async () => {
    const provider = new MockLlmProvider(() => ({ answer: "x", score: 1 }));
    const { service, entries } = setup(provider);

    await expect(
      service.generateStructured(request({ prompt: "a".repeat(2_000) })),
    ).rejects.toMatchObject({ code: "AI_LIMIT_EXCEEDED" });

    expect(provider.calls).toHaveLength(0);
    expect(entries[0]).toMatchObject({ outcome: "AI_LIMIT_EXCEEDED", outputTokens: 0 });
  });

  it("rechaza una salida que no cumple el esquema sin citar su contenido", async () => {
    const provider = new MockLlmProvider(() => ({
      answer: "SECRETO-DEL-DOCUMENTO",
      score: "alto",
    }));
    const { service, entries } = setup(provider);

    const error = await service.generateStructured(request()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ code: "AI_INVALID_OUTPUT" });
    expect((error as LlmError).message).toContain("score");
    expect((error as LlmError).message).not.toContain("SECRETO-DEL-DOCUMENTO");
    expect(entries[0]?.outcome).toBe("AI_INVALID_OUTPUT");
  });

  it("convierte el fallo del proveedor en AI_PROVIDER_UNAVAILABLE", async () => {
    const provider = new MockLlmProvider(() => {
      throw new Error("503 desde el proveedor con la clave sk-123");
    });
    const { service, entries } = setup(provider);

    const error = (await service
      .generateStructured(request())
      .catch((e: unknown) => e)) as LlmError;

    expect(error.code).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(error.isProviderFailure).toBe(true);
    expect(error.message).not.toContain("sk-123");
    expect(entries[0]?.outcome).toBe("AI_PROVIDER_UNAVAILABLE");
  });

  it("corta con AI_TIMEOUT y cancela la señal aunque el proveedor la ignore", async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    const provider = new MockLlmProvider((req) => {
      signal = req.signal;
      return new Promise(() => undefined);
    });
    const { service, entries } = setup(provider);

    const pending = service.generateStructured(request({ timeoutMs: 200 }));
    const assertion = expect(pending).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    await jest.advanceTimersByTimeAsync(200);
    await assertion;

    expect(signal?.aborted).toBe(true);
    expect(entries[0]?.outcome).toBe("AI_TIMEOUT");
  });

  it("no deja temporizadores pendientes cuando el proveedor responde a tiempo", async () => {
    jest.useFakeTimers();
    const provider = new MockLlmProvider(() => ({ answer: "x", score: 1 }));
    const { service } = setup(provider);

    await service.generateStructured(request());

    expect(jest.getTimerCount()).toBe(0);
  });

  it("sin proveedor configurado responde AI_PROVIDER_UNAVAILABLE y no inventa nada", async () => {
    const { service } = setup(new UnavailableLlmProvider());

    await expect(service.generateStructured(request())).rejects.toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
    });
  });

  it("el registro de consumo solo contiene metadatos escalares", async () => {
    const provider = new MockLlmProvider(() => ({ answer: "texto del docente", score: 1 }));
    const { service, entries } = setup(provider);

    await service.generateStructured(request({ prompt: "datos del sílabo" }));

    for (const value of Object.values(entries[0] as LlmUsageEntry)) {
      expect(["string", "number"]).toContain(typeof value);
    }
    expect(JSON.stringify(entries[0])).not.toContain("datos del sílabo");
    expect(JSON.stringify(entries[0])).not.toContain("texto del docente");
  });

  describe("chat", () => {
    const chat = (overrides = {}) => ({
      purpose: "assistant_chat",
      system: "Eres un asistente.",
      messages: [{ role: "user" as const, content: "Hola" }],
      tools: [],
      ...overrides,
    });

    it("devuelve el turno del modelo, entrega los trozos en orden y registra el consumo", async () => {
      const provider = new MockLlmProvider();
      provider.respondToChatWith(() => ({ kind: "text", text: "uno dos tres" }));
      const { service, entries } = setup(provider, { ...LIMITS, maxInputTokens: 1_000 });
      const pieces: string[] = [];

      const result = await service.chat(chat({ onToken: (text: string) => pieces.push(text) }));

      expect(result).toMatchObject({ kind: "text", text: "uno dos tres", model: "mock-1" });
      expect(pieces.join("")).toBe("uno dos tres");
      expect(entries[0]).toMatchObject({ purpose: "assistant_chat", outcome: "ok" });
    });

    it("rechaza la entrada que supera el tope sin llamar al proveedor", async () => {
      const provider = new MockLlmProvider();
      provider.respondToChatWith(() => ({ kind: "text", text: "x" }));
      const { service, entries } = setup(provider);

      await expect(
        service.chat(chat({ messages: [{ role: "user", content: "a".repeat(2_000) }] })),
      ).rejects.toMatchObject({ code: "AI_LIMIT_EXCEEDED" });
      expect(provider.chatCalls).toHaveLength(0);
      expect(entries[0]).toMatchObject({ outcome: "AI_LIMIT_EXCEEDED" });
    });

    it("convierte el fallo del proveedor en AI_PROVIDER_UNAVAILABLE", async () => {
      const provider = new MockLlmProvider();
      provider.respondToChatWith(() => {
        throw new Error("caído");
      });
      const { service } = setup(provider, { ...LIMITS, maxInputTokens: 1_000 });

      await expect(service.chat(chat())).rejects.toMatchObject({
        code: "AI_PROVIDER_UNAVAILABLE",
      });
    });

    it("sin proveedor configurado no inventa una respuesta", async () => {
      const { service } = setup(new UnavailableLlmProvider(), { ...LIMITS, maxInputTokens: 1_000 });

      await expect(service.chat(chat())).rejects.toMatchObject({
        code: "AI_PROVIDER_UNAVAILABLE",
      });
    });
  });
});
