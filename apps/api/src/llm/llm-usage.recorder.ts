import { Injectable, Logger } from "@nestjs/common";
import type { LlmErrorCode } from "./llm.errors";

/**
 * Registro de una llamada al proveedor. Solo metadatos escalares: nunca el prompt, la salida ni
 * texto de documentos o de estudiantes.
 */
export interface LlmUsageEntry {
  /** Para qué se llamó, por ejemplo `syllabus_extraction`. */
  purpose: string;
  provider: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  outcome: "ok" | LlmErrorCode;
}

export abstract class LlmUsageRecorder {
  abstract record(entry: LlmUsageEntry): void;
}

/** Deja el consumo en el log. Cuando se defina el costo por docente (RNF-07) se guardará en base. */
@Injectable()
export class LoggerLlmUsageRecorder extends LlmUsageRecorder {
  private readonly logger = new Logger("LlmUsage");

  record(entry: LlmUsageEntry): void {
    const line =
      `purpose=${entry.purpose} provider=${entry.provider} model=${entry.model ?? "-"} ` +
      `inputTokens=${entry.inputTokens} outputTokens=${entry.outputTokens} ` +
      `durationMs=${entry.durationMs} outcome=${entry.outcome}`;
    if (entry.outcome === "ok") this.logger.log(line);
    else this.logger.warn(line);
  }
}
