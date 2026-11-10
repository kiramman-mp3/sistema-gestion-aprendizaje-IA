/** Consumo de tokens de una llamada al proveedor. */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Petición que `LlmService` entrega al adaptador del proveedor. Los límites ya están aplicados:
 * el adaptador no decide tiempos ni topes, solo los respeta.
 */
export interface LlmProviderRequest {
  /** Instrucciones fijas del sistema; nunca incluyen texto del documento. */
  system: string;
  /** Mensaje del usuario. El texto no confiable (sílabos, mensajes) va delimitado como datos. */
  prompt: string;
  /** Nombre del esquema pedido, para proveedores con salida estructurada nativa. */
  schemaName: string;
  /** Esquema JSON de la salida esperada. */
  jsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
  /** Se cancela al vencer el tiempo límite. */
  signal: AbortSignal;
}

export interface LlmProviderResponse {
  /** Salida ya convertida a JSON; `LlmService` la valida con Zod antes de usarla. */
  output: unknown;
  model: string;
  usage: LlmUsage;
}

/**
 * Adaptador de un proveedor de IA (ADR-009). El código de la aplicación no depende de ningún SDK:
 * habla con `LlmService`, que aplica límites, validación y registro de consumo sobre este contrato.
 *
 * Hoy solo cubre la salida estructurada (Sprint 5). Las herramientas, el streaming y los embeddings
 * se añaden en los sprints 8 y 9, cuando haya un proveedor elegido (D-07).
 */
export abstract class LlmProvider {
  abstract readonly name: string;

  /** Lanza cualquier error del proveedor; `LlmService` lo convierte en `AI_PROVIDER_UNAVAILABLE`. */
  abstract generateStructured(request: LlmProviderRequest): Promise<LlmProviderResponse>;
}

/** Estimación gruesa (4 caracteres por token) para aplicar el tope de entrada antes de llamar. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
