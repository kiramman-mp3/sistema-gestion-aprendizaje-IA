import { EmbeddingProvider, type EmbeddingResult } from "../embedding-provider";
import { GEMINI_BASE_URL, GeminiHttpError, reasonOf, type FetchLike } from "./gemini-llm.provider";

/** Dimensión de los vectores; debe coincidir con `vector(1024)` de `document_chunks`. */
export const GEMINI_EMBEDDING_DIMENSIONS = 1024;

export interface GeminiEmbeddingOptions {
  apiKey: string;
  model: string;
  /** Similitud de coseno mínima de una coincidencia; se calibra con las pruebas de recuperación. */
  minScore: number;
  baseUrl?: string;
  fetch?: FetchLike;
}

/** Normaliza a longitud 1: con menos de 3072 dimensiones Gemini no lo hace y el coseno lo necesita. */
export function normalize(vector: number[]): number[] {
  const norm = Math.hypot(...vector);
  return norm === 0 ? vector : vector.map((value) => value / norm);
}

/**
 * Embeddings de Gemini (ADR-019). Pide vectores de 1024 dimensiones (`outputDimensionality`) para no cambiar el
 * esquema de la base, distingue documento y pregunta con `taskType` y envía hasta 100 textos por llamada.
 */
export class GeminiEmbeddingProvider extends EmbeddingProvider {
  readonly name = "gemini";
  readonly dimensions = GEMINI_EMBEDDING_DIMENSIONS;
  private readonly baseUrl: string;
  private readonly doFetch: FetchLike;

  constructor(private readonly options: GeminiEmbeddingOptions) {
    super();
    this.baseUrl = options.baseUrl ?? GEMINI_BASE_URL;
    this.doFetch = options.fetch ?? ((url, init) => fetch(url, init));
  }

  /** Modelo y dimensión: dos vectores solo se comparan si salieron del mismo. */
  get model(): string {
    return `${this.options.model}-${this.dimensions}`;
  }

  get minScore(): number {
    return this.options.minScore;
  }

  async embed(
    texts: string[],
    signal: AbortSignal,
    kind: "document" | "query" = "document",
  ): Promise<EmbeddingResult> {
    const response = await this.doFetch(
      `${this.baseUrl}/models/${this.options.model}:batchEmbedContents`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.options.apiKey },
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: `models/${this.options.model}`,
            content: { parts: [{ text }] },
            outputDimensionality: this.dimensions,
            taskType: kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
          })),
        }),
        signal,
      },
    );
    if (!response.ok) throw new GeminiHttpError(response.status, await reasonOf(response));
    const body = (await response.json()) as { embeddings?: { values: number[] }[] };
    const vectors = (body.embeddings ?? []).map((e) => normalize(e.values));
    return {
      vectors,
      model: this.model,
      dimensions: this.dimensions,
    };
  }
}
