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

/** Herramienta que el modelo puede pedir. `parameters` es un JSON Schema de sus argumentos. */
export interface LlmToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  /** Argumentos tal como los devolvió el modelo; `LlmService` no los interpreta, el orquestador los valida. */
  arguments: unknown;
}

/** Mensaje de la conversación que se entrega al modelo. El contenido ya viene seudonimizado. */
export type LlmChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: LlmToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface LlmChatRequest {
  system: string;
  messages: LlmChatMessage[];
  tools: LlmToolSpec[];
  maxOutputTokens: number;
  signal: AbortSignal;
  /** Los proveedores con streaming entregan aquí cada trozo de la respuesta final, en orden. */
  onToken?: (text: string) => void;
}

/** Un turno del modelo: o responde con texto, o pide herramientas. */
export type LlmChatResponse =
  | { kind: "text"; text: string; model: string; usage: LlmUsage }
  | { kind: "tool_calls"; calls: LlmToolCall[]; model: string; usage: LlmUsage };

/**
 * Adaptador de un proveedor de IA (ADR-009). El código de la aplicación no depende de ningún SDK:
 * habla con `LlmService`, que aplica límites, validación y registro de consumo sobre este contrato.
 *
 * Cubre la salida estructurada (Sprint 5) y el turno de conversación con herramientas (Sprint 8).
 * Los embeddings se añaden en el Sprint 9, cuando haya un proveedor elegido (D-07).
 */
export abstract class LlmProvider {
  abstract readonly name: string;

  /** Lanza cualquier error del proveedor; `LlmService` lo convierte en `AI_PROVIDER_UNAVAILABLE`. */
  abstract generateStructured(request: LlmProviderRequest): Promise<LlmProviderResponse>;

  /** Un turno de conversación con herramientas. Mismo contrato de errores que `generateStructured`. */
  abstract generateChat(request: LlmChatRequest): Promise<LlmChatResponse>;
}

/** Estimación gruesa (4 caracteres por token) para aplicar el tope de entrada antes de llamar. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
