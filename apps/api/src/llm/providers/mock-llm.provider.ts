import { estimateTokens, LlmProvider } from "../llm-provider";
import type { LlmProviderRequest, LlmProviderResponse } from "../llm-provider";

export type MockResponder = (request: LlmProviderRequest) => unknown | Promise<unknown>;

/**
 * Proveedor simulado (ADR-009). Devuelve lo que decide `responder`, sin red ni costo, para probar
 * el resto del sistema mientras se decide el proveedor real (D-07). Guarda las peticiones recibidas.
 */
export class MockLlmProvider extends LlmProvider {
  readonly name = "mock";
  readonly calls: LlmProviderRequest[] = [];

  constructor(private responder?: MockResponder) {
    super();
  }

  /** Cambia la respuesta de las llamadas siguientes. */
  respondWith(responder: MockResponder): void {
    this.responder = responder;
  }

  async generateStructured(request: LlmProviderRequest): Promise<LlmProviderResponse> {
    this.calls.push(request);
    if (!this.responder) {
      throw new Error("MockLlmProvider no tiene una respuesta programada.");
    }
    const output = await this.responder(request);
    return {
      output,
      model: "mock-1",
      usage: {
        inputTokens: estimateTokens(request.system) + estimateTokens(request.prompt),
        outputTokens: estimateTokens(JSON.stringify(output) ?? ""),
      },
    };
  }
}
