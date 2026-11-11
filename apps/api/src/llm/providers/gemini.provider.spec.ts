import { LlmService } from "../llm.service";
import type { LlmChatMessage } from "../llm-provider";
import { GeminiEmbeddingProvider, normalize } from "./gemini-embedding.provider";
import {
  GeminiHttpError,
  GeminiLlmProvider,
  readServerSentEvents,
  toGeminiContents,
} from "./gemini-llm.provider";

const KEY = "clave-secreta-de-prueba";
const signal = new AbortController().signal;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const sse = (...events: unknown[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });

function setup(responses: (() => Response)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("sin respuesta preparada");
    return next();
  });
  const provider = new GeminiLlmProvider({
    apiKey: KEY,
    model: "gemini-test",
    fetch: fetchFn,
    retryDelayMs: 1,
  });
  return { provider, calls, fetchFn };
}

const body = (call: { init: RequestInit }) => JSON.parse(call.init.body as string);

describe("GeminiLlmProvider · salida estructurada", () => {
  const ok = () =>
    json({
      candidates: [{ content: { parts: [{ text: '{"answer":"hola"}' }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 6 },
    });

  it("pide JSON con el esquema, sin `$schema`, y devuelve la salida con el consumo (el pensamiento cuenta como salida)", async () => {
    const { provider, calls } = setup([ok]);

    const result = await provider.generateStructured({
      system: "Responde en JSON.",
      prompt: "Pregunta",
      schemaName: "x",
      jsonSchema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: { answer: { type: "string" } },
      },
      maxOutputTokens: 500,
      signal,
    });

    expect(result).toEqual({
      output: { answer: "hola" },
      model: "gemini-test",
      usage: { inputTokens: 10, outputTokens: 10 },
    });
    const sent = body(calls[0]!);
    expect(sent.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      maxOutputTokens: 500,
      temperature: 0,
      responseJsonSchema: { type: "object" },
    });
    expect(sent.generationConfig.responseJsonSchema.$schema).toBeUndefined();
    expect(sent.systemInstruction.parts[0].text).toBe("Responde en JSON.");
    expect(sent.contents).toEqual([{ role: "user", parts: [{ text: "Pregunta" }] }]);
  });

  it("la clave va en la cabecera, no en la URL, y el cuerpo no la contiene", async () => {
    const { provider, calls } = setup([ok]);

    await provider.generateStructured({
      system: "s",
      prompt: "p",
      schemaName: "x",
      jsonSchema: {},
      maxOutputTokens: 1,
      signal,
    });

    expect(calls[0]!.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent",
    );
    expect(calls[0]!.url).not.toContain(KEY);
    expect((calls[0]!.init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    expect(calls[0]!.init.body).not.toContain(KEY);
  });

  it("ignora los fragmentos de «pensamiento» al armar la salida", async () => {
    const { provider } = setup([
      () =>
        json({
          candidates: [
            { content: { parts: [{ text: "razonando…", thought: true }, { text: '{"a":1}' }] } },
          ],
        }),
    ]);

    const result = await provider.generateStructured({
      system: "s",
      prompt: "p",
      schemaName: "x",
      jsonSchema: {},
      maxOutputTokens: 1,
      signal,
    });

    expect(result.output).toEqual({ a: 1 });
  });

  it.each([
    [{ promptFeedback: { blockReason: "SAFETY" } }],
    [{ candidates: [{ finishReason: "SAFETY", content: { parts: [{ text: "{}" }] } }] }],
  ])("una respuesta bloqueada es un fallo del proveedor: %j", async (blocked) => {
    const { provider } = setup([() => json(blocked)]);

    await expect(
      provider.generateStructured({
        system: "s",
        prompt: "p",
        schemaName: "x",
        jsonSchema: {},
        maxOutputTokens: 1,
        signal,
      }),
    ).rejects.toBeInstanceOf(GeminiHttpError);
  });

  it("un JSON inválido falla (LlmService lo vuelve AI_PROVIDER_UNAVAILABLE)", async () => {
    const { provider } = setup([
      () => json({ candidates: [{ content: { parts: [{ text: "no es json" }] } }] }),
    ]);

    await expect(
      provider.generateStructured({
        system: "s",
        prompt: "p",
        schemaName: "x",
        jsonSchema: {},
        maxOutputTokens: 1,
        signal,
      }),
    ).rejects.toThrow();
  });
});

describe("GeminiLlmProvider · errores y reintento", () => {
  const request = {
    system: "s",
    prompt: "p",
    schemaName: "x",
    jsonSchema: {},
    maxOutputTokens: 1,
    signal,
  };
  const good = () => json({ candidates: [{ content: { parts: [{ text: "{}" }] } }] });

  it.each([503, 429])(
    "repite si Google está saturado (%i) y entrega la respuesta buena",
    async (status) => {
      const { provider, fetchFn } = setup([
        () => json({ error: { status: "UNAVAILABLE", message: "demanda alta" } }, status),
        () => json({ error: { status: "UNAVAILABLE", message: "demanda alta" } }, status),
        good,
      ]);

      await expect(provider.generateStructured(request)).resolves.toMatchObject({ output: {} });
      expect(fetchFn).toHaveBeenCalledTimes(3);
    },
  );

  it("si sigue saturado tras dos repeticiones, informa el estado y no insiste más", async () => {
    const { provider, fetchFn } = setup([
      () => json({ error: { status: "UNAVAILABLE" } }, 503),
      () => json({ error: { status: "UNAVAILABLE" } }, 503),
      () => json({ error: { status: "UNAVAILABLE" } }, 503),
      good,
    ]);

    await expect(provider.generateStructured(request)).rejects.toMatchObject({ status: 503 });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("espera lo que Google pide en `retryDelay` si es corto", async () => {
    const retry = {
      error: {
        status: "RESOURCE_EXHAUSTED",
        details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "0.01s" }],
      },
    };
    const { provider, fetchFn } = setup([() => json(retry, 429), good]);

    await expect(provider.generateStructured(request)).resolves.toMatchObject({ output: {} });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("si Google pide esperar más de 15 s, no repite y falla enseguida", async () => {
    const retry = {
      error: {
        status: "RESOURCE_EXHAUSTED",
        details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "40s" }],
      },
    };
    const { provider, fetchFn } = setup([() => json(retry, 429), good]);

    await expect(provider.generateStructured(request)).rejects.toMatchObject({ status: 429 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("un límite diario no se repite", async () => {
    const daily = {
      error: {
        status: "RESOURCE_EXHAUSTED",
        message:
          "Generate content requests per day limit exceeded on Free Tier. Please retry in 12h3m.",
      },
    };
    const { provider, fetchFn } = setup([() => json(daily, 429), good]);

    await expect(provider.generateStructured(request)).rejects.toMatchObject({ status: 429 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 404])("un %i no se repite", async (status) => {
    const { provider, fetchFn } = setup([
      () => json({ error: { status: "X", message: "detalle con datos" } }, status),
    ]);

    await expect(provider.generateStructured(request)).rejects.toMatchObject({ status });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("el mensaje del error no trae la clave ni el texto de la respuesta, solo el estado", async () => {
    const { provider } = setup([
      () => json({ error: { status: "PERMISSION_DENIED", message: `clave ${KEY} inválida` } }, 403),
    ]);

    const error = await provider.generateStructured(request).catch((e: Error) => e);

    expect((error as Error).message).toBe("Gemini respondió 403: PERMISSION_DENIED");
    expect(String(error)).not.toContain(KEY);
  });

  it("si la petición ya se canceló no espera ni repite", async () => {
    const controller = new AbortController();
    controller.abort();
    const { provider, fetchFn } = setup([() => json({ error: { status: "UNAVAILABLE" } }, 503)]);

    await expect(
      provider.generateStructured({ ...request, signal: controller.signal }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("GeminiLlmProvider · chat con herramientas", () => {
  const chat = (
    provider: GeminiLlmProvider,
    messages: LlmChatMessage[],
    onToken?: (t: string) => void,
  ) =>
    provider.generateChat({
      system: "Eres un asistente.",
      messages,
      tools: [
        {
          name: "get_pending_grading",
          description: "Pendientes",
          parameters: { $schema: "x", type: "object", properties: { cmid: { type: "integer" } } },
        },
      ],
      maxOutputTokens: 300,
      signal,
      onToken,
    });

  it("declara las herramientas con `parametersJsonSchema` y sin `$schema`", async () => {
    const { provider, calls } = setup([
      () => sse({ candidates: [{ content: { parts: [{ text: "Hola" }] } }] }),
    ]);

    await chat(provider, [{ role: "user", content: "hola" }]);

    expect(calls[0]!.url).toContain(":streamGenerateContent?alt=sse");
    const declared = body(calls[0]!).tools[0].functionDeclarations[0];
    expect(declared).toMatchObject({ name: "get_pending_grading", description: "Pendientes" });
    expect(declared.parametersJsonSchema.$schema).toBeUndefined();
    expect(declared.parametersJsonSchema.properties.cmid.type).toBe("integer");
  });

  it("sin herramientas no manda el campo `tools`", async () => {
    const { provider, calls } = setup([
      () => sse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
    ]);

    await provider.generateChat({
      system: "s",
      messages: [{ role: "user", content: "hola" }],
      tools: [],
      maxOutputTokens: 1,
      signal,
    });

    expect(body(calls[0]!).tools).toEqual([]);
  });

  it("entrega la respuesta por trozos y juntos forman el texto", async () => {
    const { provider } = setup([
      () =>
        sse(
          { candidates: [{ content: { parts: [{ text: "Hay " }] } }] },
          {
            candidates: [{ content: { parts: [{ text: "2 pendientes." }] } }],
            usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 },
          },
        ),
    ]);
    const tokens: string[] = [];

    const result = await chat(provider, [{ role: "user", content: "¿pendientes?" }], (t) =>
      tokens.push(t),
    );

    expect(tokens).toEqual(["Hay ", "2 pendientes."]);
    expect(result).toMatchObject({
      kind: "text",
      text: "Hay 2 pendientes.",
      usage: { inputTokens: 7, outputTokens: 3 },
    });
  });

  it("una llamada a herramienta conserva su firma de pensamiento y sus argumentos", async () => {
    const { provider } = setup([
      () =>
        sse({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: { name: "get_pending_grading", args: { cmid: 5 }, id: "call_1" },
                    thoughtSignature: "firma-opaca",
                  },
                ],
              },
            },
          ],
        }),
    ]);

    const result = await chat(provider, [{ role: "user", content: "¿pendientes de la tarea 5?" }]);

    expect(result).toMatchObject({
      kind: "tool_calls",
      calls: [
        {
          id: "call_1",
          name: "get_pending_grading",
          arguments: { cmid: 5 },
          signature: "firma-opaca",
        },
      ],
    });
  });

  it("sin id en la llamada, genera uno; sin argumentos, manda un objeto vacío", async () => {
    const { provider } = setup([
      () =>
        sse({
          candidates: [{ content: { parts: [{ functionCall: { name: "get_pending_grading" } }] } }],
        }),
    ]);

    const result = await chat(provider, [{ role: "user", content: "x" }]);

    expect(result).toMatchObject({
      kind: "tool_calls",
      calls: [{ id: "gemini-1", arguments: {} }],
    });
  });

  it("al volver con el resultado, repite la llamada con su firma y junta los resultados en un solo turno", async () => {
    const { provider, calls } = setup([
      () => sse({ candidates: [{ content: { parts: [{ text: "Listo" }] } }] }),
    ]);

    await chat(provider, [
      { role: "user", content: "¿pendientes?" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "1", name: "get_pending_grading", arguments: { cmid: 5 }, signature: "firma-1" },
          { id: "2", name: "get_pending_grading", arguments: {} },
        ],
      },
      {
        role: "tool",
        toolCallId: "1",
        name: "get_pending_grading",
        content: "<resultado>uno</resultado>",
      },
      {
        role: "tool",
        toolCallId: "2",
        name: "get_pending_grading",
        content: "<resultado>dos</resultado>",
      },
    ]);

    const contents = body(calls[0]!).contents;
    expect(contents).toHaveLength(3);
    expect(contents[1]).toEqual({
      role: "model",
      parts: [
        {
          functionCall: { name: "get_pending_grading", args: { cmid: 5 } },
          thoughtSignature: "firma-1",
        },
        { functionCall: { name: "get_pending_grading", args: {} } },
      ],
    });
    expect(contents[2].role).toBe("user");
    expect(
      contents[2].parts.map(
        (p: { functionResponse: { response: { result: string } } }) =>
          p.functionResponse.response.result,
      ),
    ).toEqual(["<resultado>uno</resultado>", "<resultado>dos</resultado>"]);
  });

  it("no descarta una respuesta sin texto ni llamadas: devuelve texto vacío", async () => {
    const { provider } = setup([
      () => sse({ candidates: [{ content: { parts: [] }, finishReason: "STOP" }] }),
    ]);

    expect(await chat(provider, [{ role: "user", content: "x" }])).toMatchObject({
      kind: "text",
      text: "",
    });
  });

  it("un bloqueo de seguridad a mitad del flujo es un fallo", async () => {
    const { provider } = setup([() => sse({ candidates: [{ finishReason: "SAFETY" }] })]);

    await expect(chat(provider, [{ role: "user", content: "x" }])).rejects.toBeInstanceOf(
      GeminiHttpError,
    );
  });
});

describe("toGeminiContents y readServerSentEvents", () => {
  it("un mensaje del asistente vacío y sin llamadas no manda partes vacías inválidas", () => {
    expect(toGeminiContents([{ role: "assistant", content: "" }])).toEqual([
      { role: "model", parts: [{ text: "" }] },
    ]);
  });

  it("un resultado de herramienta tras un mensaje de usuario normal abre su propio turno", () => {
    const contents = toGeminiContents([
      { role: "user", content: "hola" },
      { role: "tool", toolCallId: "1", name: "t", content: "r" },
    ]);

    expect(contents.map((c) => c.role)).toEqual(["user", "user"]);
  });

  it("lee eventos aunque lleguen partidos en trozos", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const piece of ['data: {"a"', ":1}\n\nda", 'ta: {"b":2}\r\n\r\n'])
          controller.enqueue(encoder.encode(piece));
        controller.close();
      },
    });

    const events: string[] = [];
    for await (const event of readServerSentEvents(new Response(stream))) events.push(event);

    expect(events).toEqual(['{"a":1}', '{"b":2}']);
  });
});

describe("GeminiEmbeddingProvider", () => {
  const vectors = (n: number) => ({
    embeddings: Array.from({ length: n }, () => ({ values: [3, 4, ...new Array(1022).fill(0)] })),
  });

  function embedSetup(response: () => Response) {
    const calls: { url: string; init: RequestInit }[] = [];
    const provider = new GeminiEmbeddingProvider({
      apiKey: KEY,
      model: "gemini-embedding-001",
      minScore: 0.5,
      fetch: async (url, init) => {
        calls.push({ url, init });
        return response();
      },
    });
    return { provider, calls };
  }

  it("pide 1024 dimensiones con el tipo de tarea de documento y normaliza el resultado", async () => {
    const { provider, calls } = embedSetup(() => json(vectors(2)));

    const result = await provider.embed(["uno", "dos"], signal);

    expect(calls[0]!.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents",
    );
    const sent = body(calls[0]!);
    expect(sent.requests).toHaveLength(2);
    expect(sent.requests[0]).toMatchObject({
      model: "models/gemini-embedding-001",
      outputDimensionality: 1024,
      taskType: "RETRIEVAL_DOCUMENT",
      content: { parts: [{ text: "uno" }] },
    });
    expect(result.dimensions).toBe(1024);
    expect(result.model).toBe("gemini-embedding-001-1024");
    expect(result.vectors[0]!.slice(0, 2)).toEqual([0.6, 0.8]);
    expect(Math.hypot(...result.vectors[0]!)).toBeCloseTo(1, 6);
  });

  it("una pregunta se pide con el tipo de tarea de consulta", async () => {
    const { provider, calls } = embedSetup(() => json(vectors(1)));

    await provider.embed(["¿qué dice?"], signal, "query");

    expect(body(calls[0]!).requests[0].taskType).toBe("RETRIEVAL_QUERY");
  });

  it("expone el mínimo de similitud configurado y la clave solo va en la cabecera", async () => {
    const { provider, calls } = embedSetup(() => json(vectors(1)));
    await provider.embed(["x"], signal);

    expect(provider.minScore).toBe(0.5);
    expect(calls[0]!.url).not.toContain(KEY);
    expect(calls[0]!.init.body).not.toContain(KEY);
  });

  it("un error de Google lo informa con su estado y sin la clave", async () => {
    const { provider } = embedSetup(() =>
      json({ error: { status: "RESOURCE_EXHAUSTED", message: `cuota de ${KEY}` } }, 429),
    );

    const error = await provider.embed(["x"], signal).catch((e: Error) => e);

    expect((error as Error).message).toBe("Gemini respondió 429: RESOURCE_EXHAUSTED");
  });

  it("encaja con LlmService: vectores de la dimensión pedida pasan la validación, otros no", async () => {
    const good = embedSetup(() => json(vectors(1)));
    const service = new LlmService(
      {} as never,
      { record: () => undefined },
      { maxInputTokens: 1000, maxOutputTokens: 1, timeoutMs: 1000 },
      good.provider,
    );

    await expect(
      service.embed({ purpose: "rag_query", texts: ["x"], kind: "query" }),
    ).resolves.toMatchObject({ dimensions: 1024 });

    const short = embedSetup(() => json({ embeddings: [{ values: [1, 0] }] }));
    const bad = new LlmService(
      {} as never,
      { record: () => undefined },
      { maxInputTokens: 1000, maxOutputTokens: 1, timeoutMs: 1000 },
      short.provider,
    );
    await expect(bad.embed({ purpose: "rag_query", texts: ["x"] })).rejects.toMatchObject({
      code: "AI_INVALID_OUTPUT",
    });
  });

  it("normalize deja el vector nulo como está", () => {
    expect(normalize([0, 0])).toEqual([0, 0]);
  });
});
