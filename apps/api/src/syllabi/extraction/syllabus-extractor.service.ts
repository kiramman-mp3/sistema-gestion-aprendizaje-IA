import { Injectable } from "@nestjs/common";
import {
  documentTextSchema,
  findConsistencyIssues,
  syllabusExtractionSchema,
  type ConsistencyIssue,
  type SyllabusExtraction,
} from "@smart-lms/contracts";
import type { LlmUsage } from "../../llm/llm-provider";
import { LlmError } from "../../llm/llm.errors";
import { LlmService } from "../../llm/llm.service";
import { groundExtraction } from "./grounding";
import {
  buildExtractionPrompt,
  EXTRACTION_SYSTEM_PROMPT,
  renderDocumentText,
} from "./syllabus-prompt";

export interface SyllabusExtractionResult {
  extraction: SyllabusExtraction;
  consistencyIssues: ConsistencyIssue[];
  model: string;
  usage: LlmUsage;
  /** Rutas de datos anulados por no estar en el documento. */
  droppedPaths: string[];
}

/**
 * Del texto de un sílabo (`extracted_text`) al esquema v1 (RF-05, RF-06). Solo transforma: no toca la
 * base de datos ni el estado del sílabo; eso lo hace el flujo de versiones.
 */
@Injectable()
export class SyllabusExtractorService {
  constructor(private readonly llm: LlmService) {}

  async extract(extractedText: unknown): Promise<SyllabusExtractionResult> {
    const text = documentTextSchema.safeParse(extractedText);
    if (!text.success) {
      throw new LlmError("AI_INVALID_OUTPUT", "El texto extraído del sílabo no es válido.");
    }

    const result = await this.llm.generateStructured({
      purpose: "syllabus_extraction",
      system: EXTRACTION_SYSTEM_PROMPT,
      prompt: buildExtractionPrompt(text.data),
      schema: syllabusExtractionSchema,
      schemaName: "syllabus_extraction_v1",
    });

    // Sin marcas de página: el "3" de "[p. 3]" no puede dar por buena una ponderación del 3 %.
    const grounded = groundExtraction(
      result.data,
      renderDocumentText(text.data, false),
      text.data.pageCount,
    );
    return {
      extraction: grounded.extraction,
      consistencyIssues: findConsistencyIssues(grounded.extraction),
      model: result.model,
      usage: result.usage,
      droppedPaths: grounded.dropped.map((item) => item.path),
    };
  }
}
