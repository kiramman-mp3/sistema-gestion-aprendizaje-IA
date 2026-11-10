import { EmbeddingProvider, type EmbeddingResult } from "./embedding-provider";
import { LlmProvider } from "./llm-provider";
import type { LlmUsageEntry, LlmUsageRecorder } from "./llm-usage.recorder";
import { LlmService, type LlmLimits } from "./llm.service";
import { HashingEmbeddingProvider } from "./providers/hashing-embedding.provider";
import { MockLlmProvider } from "./providers/mock-llm.provider";
import { UnavailableEmbeddingProvider } from "./providers/unavailable-embedding.provider";

const LIMITS: LlmLimits = { maxInputTokens: 100, maxOutputTokens: 500, timeoutMs: 200 };

class FakeEmbeddings extends EmbeddingProvider {
  readonly name = "fake";
  readonly model = "fake-4";
  readonly dimensions = 4;
  readonly minScore = 0.3;
  constructor(private readonly respond: (texts: string[]) => Promise<EmbeddingResult>) {
    super();
  }
  embed(texts: string[]): Promise<EmbeddingResult> {
    return this.respond(texts);
  }
}

function setup(embeddings?: EmbeddingProvider) {
  const entries: LlmUsageEntry[] = [];
  const recorder: LlmUsageRecorder = { record: (entry) => entries.push(entry) };
  const provider: LlmProvider = new MockLlmProvider();
  return { service: new LlmService(provider, recorder, LIMITS, embeddings), entries };
}

const ok = (texts: string[]): Promise<EmbeddingResult> =>
  Promise.resolve({
    vectors: texts.map(() => [1, 0, 0, 0]),
    model: "fake-4",
    dimensions: 4,
  });

describe("LlmService.embed", () => {
  it("devuelve un vector por texto y registra el consumo sin el texto", async () => {
    const { service, entries } = setup(new FakeEmbeddings(ok));

    const result = await service.embed({ purpose: "rag_indexing", texts: ["uno", "dos"] });

    expect(result.vectors).toHaveLength(2);
    expect(entries).toEqual([
      expect.objectContaining({
        purpose: "rag_indexing",
        provider: "fake",
        model: "fake-4",
        outputTokens: 0,
        outcome: "ok",
      }),
    ]);
    expect(JSON.stringify(entries)).not.toContain("uno");
  });

  it("sin proveedor de embeddings responde AI_PROVIDER_UNAVAILABLE", async () => {
    const { service, entries } = setup(undefined);

    await expect(service.embed({ purpose: "rag_query", texts: ["x"] })).rejects.toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
    });
    expect(entries[0]).toMatchObject({ outcome: "AI_PROVIDER_UNAVAILABLE", provider: "none" });
  });

  it("el proveedor «unavailable» también responde AI_PROVIDER_UNAVAILABLE", async () => {
    const { service } = setup(new UnavailableEmbeddingProvider());

    await expect(service.embed({ purpose: "rag_query", texts: ["x"] })).rejects.toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
    });
  });

  it("si el proveedor tarda más del tiempo límite, responde AI_TIMEOUT", async () => {
    const { service } = setup(new FakeEmbeddings(() => new Promise(() => undefined)));

    await expect(service.embed({ purpose: "rag_query", texts: ["x"] })).rejects.toMatchObject({
      code: "AI_TIMEOUT",
    });
  });

  it("si la entrada supera el tope de tokens, no llama al proveedor", async () => {
    const respond = jest.fn(ok);
    const { service } = setup(new FakeEmbeddings(respond));

    await expect(
      service.embed({ purpose: "rag_indexing", texts: ["palabra ".repeat(200)] }),
    ).rejects.toMatchObject({ code: "AI_LIMIT_EXCEEDED" });
    expect(respond).not.toHaveBeenCalled();
  });

  it("rechaza vectores que no corresponden a lo pedido", async () => {
    const wrongCount = new FakeEmbeddings(async () => ({
      vectors: [[1, 0, 0, 0]],
      model: "m",
      dimensions: 4,
    }));
    const wrongSize = new FakeEmbeddings(async (texts) => ({
      vectors: texts.map(() => [1, 0]),
      model: "m",
      dimensions: 2,
    }));

    for (const embeddings of [wrongCount, wrongSize]) {
      await expect(
        setup(embeddings).service.embed({ purpose: "rag_query", texts: ["a", "b"] }),
      ).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT" });
    }
  });

  it("un error cualquiera del proveedor se vuelve AI_PROVIDER_UNAVAILABLE", async () => {
    const { service } = setup(
      new FakeEmbeddings(() => Promise.reject(new Error("503 del proveedor"))),
    );

    await expect(service.embed({ purpose: "rag_query", texts: ["a"] })).rejects.toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
    });
  });

  it("expone la dimensión del proveedor", () => {
    expect(setup(new HashingEmbeddingProvider()).service.embeddingDimensions).toBe(1024);
    expect(setup(undefined).service.embeddingDimensions).toBeNull();
    expect(setup(new FakeEmbeddings(ok)).service.embeddingMinScore).toBe(0.3);
    expect(setup(undefined).service.embeddingMinScore).toBeNull();
  });
});
