import { estimateTokens, LlmProvider } from "../llm-provider";
import type {
  LlmChatRequest,
  LlmChatResponse,
  LlmProviderRequest,
  LlmProviderResponse,
} from "../llm-provider";

export type MockResponder = (request: LlmProviderRequest) => unknown | Promise<unknown>;

/** Lo que decide el simulador en cada turno de conversación (sin `model` ni `usage`). */
export type MockChatTurn =
  | { kind: "text"; text: string }
  | { kind: "tool_calls"; calls: { id: string; name: string; arguments: unknown }[] };

/** `turn` es el número de resultados de herramientas ya recibidos: 0 en la primera llamada. */
export type MockChatResponder = (
  request: LlmChatRequest,
  turn: number,
) => MockChatTurn | Promise<MockChatTurn>;

/**
 * Proveedor simulado (ADR-009). Devuelve lo que decide `responder`, sin red ni costo, para probar
 * el resto del sistema mientras se decide el proveedor real (D-07). Guarda las peticiones recibidas.
 */
export class MockLlmProvider extends LlmProvider {
  readonly name = "mock";
  readonly calls: LlmProviderRequest[] = [];
  readonly chatCalls: LlmChatRequest[] = [];
  private chatResponder?: MockChatResponder;

  constructor(private responder?: MockResponder) {
    super();
  }

  /** Cambia la respuesta de las llamadas siguientes. */
  respondWith(responder: MockResponder): void {
    this.responder = responder;
  }

  /** Programa los turnos de conversación. */
  respondToChatWith(responder: MockChatResponder): void {
    this.chatResponder = responder;
  }

  async generateChat(request: LlmChatRequest): Promise<LlmChatResponse> {
    this.chatCalls.push(request);
    if (!this.chatResponder) {
      throw new Error("MockLlmProvider no tiene una respuesta de chat programada.");
    }
    const turn = request.messages.filter((message) => message.role === "tool").length;
    const answer = await this.chatResponder(request, turn);
    const usage = {
      inputTokens: estimateTokens(request.system + JSON.stringify(request.messages)),
      outputTokens: estimateTokens(JSON.stringify(answer)),
    };
    if (answer.kind === "tool_calls") {
      return { kind: "tool_calls", calls: answer.calls, model: "mock-1", usage };
    }
    // Entrega la respuesta por trozos, como lo haría un proveedor con streaming.
    for (const piece of answer.text.match(/\S+\s*/g) ?? []) request.onToken?.(piece);
    return { kind: "text", text: answer.text, model: "mock-1", usage };
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
