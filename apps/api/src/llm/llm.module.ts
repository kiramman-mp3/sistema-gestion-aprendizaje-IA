import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { EmbeddingProvider } from "./embedding-provider";
import { LlmProvider } from "./llm-provider";
import { LlmUsageRecorder, LoggerLlmUsageRecorder } from "./llm-usage.recorder";
import { LLM_LIMITS, LlmService, type LlmLimits } from "./llm.service";
import { DemoLlmProvider } from "./providers/demo-llm.provider";
import { GeminiEmbeddingProvider } from "./providers/gemini-embedding.provider";
import { GeminiLlmProvider } from "./providers/gemini-llm.provider";
import { HashingEmbeddingProvider } from "./providers/hashing-embedding.provider";
import { UnavailableEmbeddingProvider } from "./providers/unavailable-embedding.provider";
import { UnavailableLlmProvider } from "./providers/unavailable-llm.provider";

@Global()
@Module({
  providers: [
    {
      provide: LlmProvider,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): LlmProvider => {
        const provider = config.get("AI_PROVIDER", { infer: true });
        const apiKey = config.get("AI_API_KEY", { infer: true });
        if (provider === "gemini" && apiKey) {
          return new GeminiLlmProvider({ apiKey, model: config.get("AI_MODEL", { infer: true }) });
        }
        return provider === "mock" ? new DemoLlmProvider() : new UnavailableLlmProvider();
      },
    },
    {
      provide: EmbeddingProvider,
      inject: [ConfigService],
      // La dimensión del proveedor debe coincidir con la de la base (ADR-019).
      useFactory: (config: ConfigService<Env, true>): EmbeddingProvider => {
        const provider = config.get("AI_PROVIDER", { infer: true });
        const apiKey = config.get("AI_API_KEY", { infer: true });
        if (provider === "gemini" && apiKey) {
          return new GeminiEmbeddingProvider({
            apiKey,
            model: config.get("AI_EMBEDDING_MODEL", { infer: true }),
            minScore: config.get("AI_EMBEDDING_MIN_SCORE", { infer: true }),
          });
        }
        return provider === "mock"
          ? new HashingEmbeddingProvider()
          : new UnavailableEmbeddingProvider();
      },
    },
    { provide: LlmUsageRecorder, useClass: LoggerLlmUsageRecorder },
    {
      provide: LLM_LIMITS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): LlmLimits => ({
        maxInputTokens: config.get("AI_MAX_INPUT_TOKENS", { infer: true }),
        maxOutputTokens: config.get("AI_MAX_OUTPUT_TOKENS", { infer: true }),
        timeoutMs: config.get("AI_TIMEOUT_MS", { infer: true }),
      }),
    },
    LlmService,
  ],
  exports: [LlmService, LlmProvider, EmbeddingProvider],
})
export class LlmModule {}
