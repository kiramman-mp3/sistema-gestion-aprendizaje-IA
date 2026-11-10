import {
  LlmProvider,
  type LlmChatMessage,
  type LlmChatRequest,
  type LlmChatResponse,
  type LlmProviderRequest,
  type LlmProviderResponse,
  type LlmToolCall,
  type LlmToolSpec,
  type LlmUsage,
} from "../llm-provider";

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/** Función `fetch`; se inyecta para probar el adaptador sin red. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface GeminiOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetch?: FetchLike;
  /** Espera antes de repetir una llamada rechazada por saturación (1500 ms por defecto). */
  retryDelayMs?: number;
}

/** Error del proveedor sin la clave ni el cuerpo de la petición: solo el estado y el motivo que informa Google. */
export class GeminiHttpError extends Error {
  constructor(
    readonly status: number,
    reason: string,
  ) {
    super(`Gemini respondió ${status}${reason ? `: ${reason}` : ""}`);
    this.name = "GeminiHttpError";
  }
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: unknown; id?: string };
  functionResponse?: { name: string; response: unknown; id?: string };
}
interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
}

/** Quita lo que el esquema JSON de Zod trae y Gemini no acepta como raíz. */
function cleanSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = schema;
  return rest;
}

/**
 * Mensajes de la conversación en el formato de Gemini. Los resultados de herramientas que llegan seguidos se juntan
 * en un solo turno de usuario, y cada llamada vuelve con la firma de pensamiento que el modelo entregó (Gemini 3 la exige).
 */
export function toGeminiContents(messages: LlmChatMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      contents.push({ role: "user", parts: [{ text: message.content }] });
    } else if (message.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.toolCalls ?? []) {
        parts.push({
          functionCall: { name: call.name, args: call.arguments ?? {} },
          ...(call.signature ? { thoughtSignature: call.signature } : {}),
        });
      }
      contents.push({ role: "model", parts: parts.length > 0 ? parts : [{ text: "" }] });
    } else {
      const part: GeminiPart = {
        functionResponse: { name: message.name, response: { result: message.content } },
      };
      const last = contents.at(-1);
      if (last?.role === "user" && last.parts.every((p) => p.functionResponse))
        last.parts.push(part);
      else contents.push({ role: "user", parts: [part] });
    }
  }
  return contents;
}

function toolDeclarations(tools: LlmToolSpec[]) {
  return tools.length === 0
    ? []
    : [
        {
          functionDeclarations: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parametersJsonSchema: cleanSchema(tool.parameters),
          })),
        },
      ];
}

function usageOf(meta: GeminiResponse["usageMetadata"]): LlmUsage {
  return {
    inputTokens: meta?.promptTokenCount ?? 0,
    // Los tokens de «pensamiento» se facturan como salida.
    outputTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
  };
}

/**
 * Adaptador de Gemini (D-07, ADR-009) sobre la API REST, sin SDK. La clave viaja en la cabecera `x-goog-api-key`, nunca
 * en la URL, y ningún error la incluye. Salida estructurada con `responseJsonSchema`, chat con herramientas con
 * `functionDeclarations` y respuesta por streaming (SSE).
 */
export class GeminiLlmProvider extends LlmProvider {
  readonly name = "gemini";
  private readonly baseUrl: string;
  private readonly doFetch: FetchLike;

  constructor(private readonly options: GeminiOptions) {
    super();
    this.baseUrl = options.baseUrl ?? GEMINI_BASE_URL;
    this.doFetch = options.fetch ?? ((url, init) => fetch(url, init));
  }

  async generateStructured(request: LlmProviderRequest): Promise<LlmProviderResponse> {
    const response = await this.call("generateContent", request.signal, {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: "user", parts: [{ text: request.prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: cleanSchema(request.jsonSchema),
        maxOutputTokens: request.maxOutputTokens,
        temperature: 0,
      },
    });
    const body = (await response.json()) as GeminiResponse;
    this.assertUsable(body);
    const text = (body.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text)
      .join("");
    return {
      output: JSON.parse(text) as unknown,
      model: this.options.model,
      usage: usageOf(body.usageMetadata),
    };
  }

  async generateChat(request: LlmChatRequest): Promise<LlmChatResponse> {
    const response = await this.call("streamGenerateContent?alt=sse", request.signal, {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: toGeminiContents(request.messages),
      tools: toolDeclarations(request.tools),
      generationConfig: { maxOutputTokens: request.maxOutputTokens },
    });

    let text = "";
    const calls: LlmToolCall[] = [];
    let usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
    for await (const chunk of readServerSentEvents(response)) {
      const body = JSON.parse(chunk) as GeminiResponse;
      this.assertUsable(body);
      if (body.usageMetadata) usage = usageOf(body.usageMetadata);
      for (const part of body.candidates?.[0]?.content?.parts ?? []) {
        if (part.functionCall) {
          calls.push({
            id: part.functionCall.id ?? `gemini-${calls.length + 1}`,
            name: part.functionCall.name,
            arguments: part.functionCall.args ?? {},
            ...(part.thoughtSignature ? { signature: part.thoughtSignature } : {}),
          });
        } else if (!part.thought && typeof part.text === "string" && part.text !== "") {
          text += part.text;
          request.onToken?.(part.text);
        }
      }
    }

    if (calls.length > 0) return { kind: "tool_calls", calls, model: this.options.model, usage };
    return { kind: "text", text, model: this.options.model, usage };
  }

  /** Una respuesta bloqueada o sin candidatos no es una respuesta: se trata como fallo del proveedor. */
  private assertUsable(body: GeminiResponse): void {
    if (body.promptFeedback?.blockReason) {
      throw new GeminiHttpError(200, `petición bloqueada (${body.promptFeedback.blockReason})`);
    }
    const reason = body.candidates?.[0]?.finishReason;
    if (
      reason &&
      ["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "RECITATION"].includes(reason)
    ) {
      throw new GeminiHttpError(200, `respuesta bloqueada (${reason})`);
    }
  }

  /**
   * Hace la llamada y la repite hasta dos veces si Google responde que está saturado (503) o que se pasó el límite por
   * minuto (429): es transitorio y el docente no debería verlo. Espera lo que Google indique (`retryDelay`) o, si no
   * dice nada, 1,5 s y luego 3 s; si pide esperar más de `MAX_RETRY_WAIT_MS` (un límite diario, por ejemplo) no se
   * repite y falla enseguida. Cualquier otro error falla sin repetir.
   */
  private async call(method: string, signal: AbortSignal, body: unknown): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const response = await this.doFetch(
        `${this.baseUrl}/models/${this.options.model}:${method}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.options.apiKey },
          body: JSON.stringify(body),
          signal,
        },
      );
      if (response.ok) return response;
      const status = response.status;
      const info = await errorInfo(response);
      const transient = status === 429 || status === 503;
      const wait = info.retryAfterMs ?? (this.options.retryDelayMs ?? 1500) * (attempt + 1);
      if (transient && attempt < MAX_RETRIES && wait <= MAX_RETRY_WAIT_MS && !signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }
      throw new GeminiHttpError(status, info.reason);
    }
  }
}

/** Repeticiones máximas ante una saturación transitoria. */
const MAX_RETRIES = 2;
/** Más que esto no se espera: el docente está mirando la pantalla (y `AI_TIMEOUT_MS` corta a los 60 s). */
export const MAX_RETRY_WAIT_MS = 15_000;

/** El motivo corto y la espera que Google pide (`RetryInfo.retryDelay`, por ejemplo «27s»); nunca el cuerpo de la petición. */
export async function errorInfo(
  response: Response,
): Promise<{ reason: string; retryAfterMs: number | null }> {
  try {
    const parsed = (await response.json()) as {
      error?: {
        status?: string;
        message?: string;
        details?: {
          "@type"?: string;
          retryDelay?: string;
          violations?: { quotaId?: string }[];
        }[];
      };
    };
    const delay = parsed.error?.details?.find((d) => d["@type"]?.endsWith("RetryInfo"))?.retryDelay;
    const seconds = delay ? Number.parseFloat(delay) : Number.NaN;
    // «Please retry in 12h3m…» solo está en el mensaje: sin RetryInfo no se espera (se trata como no transitorio si es largo).
    const dailyHint = /per day|PerDay/i.test(parsed.error?.message ?? "");
    // El identificador de la cuota que se pasó (por ejemplo, por minuto o por día) ayuda a entender el 429; no trae datos.
    const quota = parsed.error?.details?.find((d) => d.violations?.length)?.violations?.[0]
      ?.quotaId;
    return {
      reason: `${(parsed.error?.status ?? "").slice(0, 60)}${quota ? ` (${quota.slice(0, 80)})` : ""}`,
      retryAfterMs: dailyHint
        ? Number.POSITIVE_INFINITY
        : Number.isFinite(seconds)
          ? Math.ceil(seconds * 1000)
          : null,
    };
  } catch {
    return { reason: "", retryAfterMs: null };
  }
}

/** El motivo corto que informa Google. */
export async function reasonOf(response: Response): Promise<string> {
  return (await errorInfo(response)).reason;
}

/** Eventos `data:` de una respuesta SSE, ya separados. */
export async function* readServerSentEvents(response: Response): AsyncGenerator<string> {
  if (!response.body) return;
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, "");
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) yield data;
    }
  }
  const rest = buffer.trim();
  if (rest.startsWith("data:")) yield rest.slice(5).trimStart();
}
