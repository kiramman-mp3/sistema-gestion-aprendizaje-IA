/**
 * Errores de la capa de IA. El código `AI_PROVIDER_UNAVAILABLE` es el del contrato OpenAPI (503):
 * cuando el proveedor falla, el backend lo dice y no inventa una respuesta.
 */
export const LLM_ERROR_CODES = [
  /** El proveedor no está configurado o respondió con un error. */
  "AI_PROVIDER_UNAVAILABLE",
  /** El proveedor no respondió dentro del tiempo permitido. */
  "AI_TIMEOUT",
  /** La salida del proveedor no cumple el esquema pedido. */
  "AI_INVALID_OUTPUT",
  /** La petición supera el límite de tokens configurado. */
  "AI_LIMIT_EXCEEDED",
] as const;

export type LlmErrorCode = (typeof LLM_ERROR_CODES)[number];

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LlmError";
  }

  /** Verdadero cuando el fallo es del proveedor y no de la petición; el cliente puede reintentar. */
  get isProviderFailure(): boolean {
    return this.code === "AI_PROVIDER_UNAVAILABLE" || this.code === "AI_TIMEOUT";
  }
}
