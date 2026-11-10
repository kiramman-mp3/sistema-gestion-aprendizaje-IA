import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { LlmProvider } from "./llm-provider";
import { LlmUsageRecorder, LoggerLlmUsageRecorder } from "./llm-usage.recorder";
import { LLM_LIMITS, LlmService, type LlmLimits } from "./llm.service";
import { MockLlmProvider } from "./providers/mock-llm.provider";
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
          ? new MockLlmProvider()
          : new UnavailableLlmProvider(),
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
  exports: [LlmService, LlmProvider],
})
export class LlmModule {}
