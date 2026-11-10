import { Inject, Injectable, Optional } from "@nestjs/common";
import { z } from "zod";
import { EmbeddingProvider, type EmbeddingResult } from "./embedding-provider";
import { LlmError } from "./llm.errors";
import {
  estimateTokens,
  LlmProvider,
  type LlmChatMessage,
  type LlmChatResponse,
  type LlmToolSpec,
  type LlmUsage,
} from "./llm-provider";
import { LlmUsageRecorder, type LlmUsageEntry } from "./llm-usage.recorder";

/** Topes que `LlmService` aplica a toda llamada; vienen del entorno. */
export interface LlmLimits {
  /** Tokens estimados de entrada (sistema + mensaje) a partir de los cuales no se llama. */
  maxInputTokens: number;
  maxOutputTokens: number;
  timeoutMs: number;
}

export const LLM_LIMITS = Symbol("LLM_LIMITS");

export interface StructuredRequest<T> {
  /** Para qué se llama, por ejemplo `syllabus_extraction`; queda en el registro de consumo. */
  purpose: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  schemaName: string;
  /** Pueden bajar los topes globales, nunca superarlos. */
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface ChatRequest {
  purpose: string;
  system: string;
  messages: LlmChatMessage[];
  tools: LlmToolSpec[];
  maxOutputTokens?: number;
  timeoutMs?: number;
  /** Trozos de la respuesta final, si el proveedor hace streaming. */
  onToken?: (text: string) => void;
}

export interface EmbedRequest {
  /** Para qué se llama, por ejemplo `rag_indexing`; queda en el registro de consumo. */
  purpose: string;
  texts: string[];
  timeoutMs?: number;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  usage: LlmUsage;
}

/**
 * Punto de entrada único a la IA. Aplica los topes de tokens y el tiempo límite, valida la salida
 * con Zod y registra el consumo de cada llamada, sea cual sea el proveedor detrás.
 */
@Injectable()
export class LlmService {
  constructor(
    private readonly provider: LlmProvider,
    private readonly usageRecorder: LlmUsageRecorder,
    @Inject(LLM_LIMITS) private readonly limits: LlmLimits,
    @Optional() private readonly embeddings?: EmbeddingProvider,
  ) {}

  /** Similitud mínima que el proveedor de embeddings considera una coincidencia. */
  get embeddingMinScore(): number | null {
    return this.embeddings?.minScore ?? null;
  }

  /** Dimensión de los vectores del proveedor de embeddings (la fija la base de datos, ADR-019). */
  get embeddingDimensions(): number | null {
    return this.embeddings?.dimensions ?? null;
  }

  /**
   * Vectores de una tanda de textos. Aplica el mismo tiempo límite y el mismo tope de entrada que las demás
   * llamadas, y deja el consumo registrado. Sin proveedor, o si falla, responde `AI_PROVIDER_UNAVAILABLE`.
   */
  async embed(request: EmbedRequest): Promise<EmbeddingResult> {
    const startedAt = Date.now();
    const provider = this.embeddings;
    const estimatedInput = estimateTokens(request.texts.join(" "));
    const record = (outcome: LlmUsageEntry["outcome"], model: string | null): void =>
      this.usageRecorder.record({
        purpose: request.purpose,
        provider: provider?.name ?? "none",
        model,
        inputTokens: estimatedInput,
        outputTokens: 0,
        durationMs: Date.now() - startedAt,
        outcome,
      });

    try {
      if (!provider) {
        throw new LlmError(
          "AI_PROVIDER_UNAVAILABLE",
          "No hay un proveedor de embeddings configurado.",
        );
      }
      if (estimatedInput > this.limits.maxInputTokens) {
        throw new LlmError(
          "AI_LIMIT_EXCEEDED",
          `La entrada (~${estimatedInput} tokens) supera el límite de ${this.limits.maxInputTokens}.`,
        );
      }
      const result = await this.withTimeout(request.timeoutMs, (signal) =>
        provider.embed(request.texts, signal),
      );
      if (
        result.vectors.length !== request.texts.length ||
        result.vectors.some((vector) => vector.length !== provider.dimensions)
      ) {
        throw new LlmError(
          "AI_INVALID_OUTPUT",
          "El proveedor de embeddings devolvió vectores que no corresponden a lo pedido.",
        );
      }
      record("ok", result.model);
      return result;
    } catch (error) {
      const llmError = this.toLlmError(error);
      record(llmError.code, provider?.model ?? null);
      throw llmError;
    }
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const startedAt = Date.now();
    const estimatedInput = estimateTokens(request.system) + estimateTokens(request.prompt);
    let model: string | null = null;
    let usage: LlmUsage = { inputTokens: estimatedInput, outputTokens: 0 };

    const record = (outcome: LlmUsageEntry["outcome"]): void =>
      this.usageRecorder.record({
        purpose: request.purpose,
        provider: this.provider.name,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        durationMs: Date.now() - startedAt,
        outcome,
      });

    try {
      if (estimatedInput > this.limits.maxInputTokens) {
        throw new LlmError(
          "AI_LIMIT_EXCEEDED",
          `La entrada (~${estimatedInput} tokens) supera el límite de ${this.limits.maxInputTokens}.`,
        );
      }

      const raw = await this.callWithTimeout(request);
      model = raw.model;
      usage = raw.usage;

      const parsed = request.schema.safeParse(raw.output);
      if (!parsed.success) {
        // Solo rutas y tipos de error: el mensaje de Zod puede citar valores de la salida.
        const paths = parsed.error.issues.map((issue) => issue.path.join(".") || "(raíz)");
        throw new LlmError(
          "AI_INVALID_OUTPUT",
          `La salida del proveedor no cumple el esquema ${request.schemaName}: ${[...new Set(paths)].join(", ")}.`,
        );
      }

      record("ok");
      return { data: parsed.data, model: raw.model, usage: raw.usage };
    } catch (error) {
      const llmError = this.toLlmError(error);
      record(llmError.code);
      throw llmError;
    }
  }

  /**
   * Un turno de conversación con herramientas. Aplica los mismos topes que `generateStructured`:
   * tokens estimados de entrada, tokens de salida y tiempo límite, y deja el consumo registrado.
   */
  async chat(request: ChatRequest): Promise<LlmChatResponse> {
    const startedAt = Date.now();
    const estimatedInput =
      estimateTokens(request.system) +
      estimateTokens(JSON.stringify(request.messages)) +
      estimateTokens(JSON.stringify(request.tools));
    let model: string | null = null;
    let usage: LlmUsage = { inputTokens: estimatedInput, outputTokens: 0 };

    const record = (outcome: LlmUsageEntry["outcome"]): void =>
      this.usageRecorder.record({
        purpose: request.purpose,
        provider: this.provider.name,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        durationMs: Date.now() - startedAt,
        outcome,
      });

    try {
      if (estimatedInput > this.limits.maxInputTokens) {
        throw new LlmError(
          "AI_LIMIT_EXCEEDED",
          `La entrada (~${estimatedInput} tokens) supera el límite de ${this.limits.maxInputTokens}.`,
        );
      }
      const response = await this.withTimeout(request.timeoutMs, (signal) =>
        this.provider.generateChat({
          system: request.system,
          messages: request.messages,
          tools: request.tools,
          maxOutputTokens: this.cappedOutput(request.maxOutputTokens),
          signal,
          onToken: request.onToken,
        }),
      );
      model = response.model;
      usage = response.usage;
      record("ok");
      return response;
    } catch (error) {
      const llmError = this.toLlmError(error);
      record(llmError.code);
      throw llmError;
    }
  }

  private callWithTimeout<T>(request: StructuredRequest<T>) {
    return this.withTimeout(request.timeoutMs, (signal) =>
      this.provider.generateStructured({
        system: request.system,
        prompt: request.prompt,
        schemaName: request.schemaName,
        jsonSchema: z.toJSONSchema(request.schema) as Record<string, unknown>,
        maxOutputTokens: this.cappedOutput(request.maxOutputTokens),
        signal,
      }),
    );
  }

  private cappedOutput(requested?: number): number {
    return Math.min(requested ?? this.limits.maxOutputTokens, this.limits.maxOutputTokens);
  }

  private async withTimeout<R>(
    requestedTimeoutMs: number | undefined,
    run: (signal: AbortSignal) => Promise<R>,
  ): Promise<R> {
    const timeoutMs = Math.min(requestedTimeoutMs ?? this.limits.timeoutMs, this.limits.timeoutMs);

    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new LlmError("AI_TIMEOUT", `El proveedor no respondió en ${timeoutMs} ms.`));
      }, timeoutMs);
    });

    try {
      // La carrera garantiza el límite aunque el adaptador ignore la señal de cancelación.
      return await Promise.race([run(controller.signal), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private toLlmError(error: unknown): LlmError {
    if (error instanceof LlmError) return error;
    return new LlmError("AI_PROVIDER_UNAVAILABLE", "El proveedor de IA no respondió.", {
      cause: error,
    });
  }
}
