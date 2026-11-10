import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { EmbeddingProvider } from "./embedding-provider";
import { LlmProvider } from "./llm-provider";
import { LlmUsageRecorder, LoggerLlmUsageRecorder } from "./llm-usage.recorder";
import { LLM_LIMITS, LlmService, type LlmLimits } from "./llm.service";
import { DemoLlmProvider } from "./providers/demo-llm.provider";
import { HashingEmbeddingProvider } from "./providers/hashing-embedding.provider";
import { UnavailableEmbeddingProvider } from "./providers/unavailable-embedding.provider";
import { UnavailableLlmProvider } from "./providers/unavailable-llm.provider";

@Global()
@Module({
  providers: [
    {
      provide: LlmProvider,
      inject: [ConfigService],
      // Cuando se decida D-07 se añade aquí el adaptador real con `AI_API_KEY`.
      useFactory: (config: ConfigService<Env, true>): LlmProvider =>
        config.get("AI_PROVIDER", { infer: true }) === "mock"
          ? new DemoLlmProvider()
          : new UnavailableLlmProvider(),
    },
    {
      provide: EmbeddingProvider,
      inject: [ConfigService],
      // Con el modelo real (D-07) se añade aquí su adaptador; la dimensión debe coincidir con la de la base.
      useFactory: (config: ConfigService<Env, true>): EmbeddingProvider =>
        config.get("AI_PROVIDER", { infer: true }) === "mock"
          ? new HashingEmbeddingProvider()
          : new UnavailableEmbeddingProvider(),
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
