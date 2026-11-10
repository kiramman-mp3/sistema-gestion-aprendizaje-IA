/** Vectores de una tanda de textos, en el mismo orden en que se pidieron. */
export interface EmbeddingResult {
  vectors: number[][];
  /** Identificador del modelo; se guarda con cada fragmento para poder reindexar si cambia. */
  model: string;
  dimensions: number;
}

/**
 * Adaptador de un modelo de embeddings (ADR-009, RF-14). Igual que `LlmProvider`, el código de la aplicación no
 * depende de ningún SDK: habla con `LlmService.embed`, que aplica tiempo límite y registra el consumo.
 *
 * La dimensión del vector está fijada en la base (`document_chunks.embedding`, ADR-019). Al elegir el modelo real
 * (D-07) con otra dimensión hace falta una migración y reindexar.
 */
export abstract class EmbeddingProvider {
  abstract readonly name: string;
  abstract readonly model: string;
  abstract readonly dimensions: number;
  /**
   * Similitud de coseno mínima para considerar que un fragmento se relaciona con la pregunta. Depende del modelo: se
   * calibra con el conjunto de referencia al elegirlo (D-07).
   */
  abstract readonly minScore: number;

  /** Lanza cualquier error del proveedor; `LlmService` lo convierte en `AI_PROVIDER_UNAVAILABLE`. */
  abstract embed(texts: string[], signal: AbortSignal): Promise<EmbeddingResult>;
}
