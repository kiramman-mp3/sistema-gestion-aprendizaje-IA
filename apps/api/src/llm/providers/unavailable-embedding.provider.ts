import { EmbeddingProvider, type EmbeddingResult } from "../embedding-provider";
import { HASHING_EMBEDDING_DIMENSIONS } from "./hashing-embedding.provider";

/** Sin proveedor configurado: toda llamada falla y `LlmService` responde `AI_PROVIDER_UNAVAILABLE`. */
export class UnavailableEmbeddingProvider extends EmbeddingProvider {
  readonly name = "unavailable";
  readonly model = "none";
  readonly dimensions = HASHING_EMBEDDING_DIMENSIONS;
  readonly minScore = 1;

  async embed(): Promise<EmbeddingResult> {
    throw new Error("No hay un proveedor de embeddings configurado (AI_PROVIDER).");
  }
}
