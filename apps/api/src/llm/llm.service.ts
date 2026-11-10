import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { LlmError } from "./llm.errors";
import { estimateTokens, LlmProvider, type LlmUsage } from "./llm-provider";
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
  ) {}

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

  private async callWithTimeout<T>(request: StructuredRequest<T>) {
    const maxOutputTokens = Math.min(
      request.maxOutputTokens ?? this.limits.maxOutputTokens,
      this.limits.maxOutputTokens,
    );
    const timeoutMs = Math.min(request.timeoutMs ?? this.limits.timeoutMs, this.limits.timeoutMs);

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
      return await Promise.race([
        this.provider.generateStructured({
          system: request.system,
          prompt: request.prompt,
          schemaName: request.schemaName,
          jsonSchema: z.toJSONSchema(request.schema) as Record<string, unknown>,
          maxOutputTokens,
          signal: controller.signal,
        }),
        timeout,
      ]);
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
