import { LlmError } from "../llm.errors";
import { LlmProvider, type LlmChatResponse, type LlmProviderResponse } from "../llm-provider";

/**
 * Proveedor por defecto mientras no se configure uno (D-07). Falla de forma explícita con
 * `AI_PROVIDER_UNAVAILABLE` en lugar de devolver una respuesta inventada.
 */
export class UnavailableLlmProvider extends LlmProvider {
  readonly name = "none";

  generateStructured(): Promise<LlmProviderResponse> {
    return Promise.reject(unavailable());
  }

  generateChat(): Promise<LlmChatResponse> {
    return Promise.reject(unavailable());
  }
}

function unavailable(): LlmError {
  return new LlmError("AI_PROVIDER_UNAVAILABLE", "No hay un proveedor de IA configurado.");
}
