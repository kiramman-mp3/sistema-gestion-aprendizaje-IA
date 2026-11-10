import type { ConsistencyIssue, SyllabusExtraction } from "@smart-lms/contracts";
import type { SyllabusExtraction as ExtractionRow } from "../../generated/prisma/client";

/** `components/schemas/SyllabusExtractionVersion` del contrato OpenAPI. */
export interface ExtractionVersionDto {
  version: number;
  schemaVersion: string;
  source: ExtractionRow["source"];
  content: SyllabusExtraction;
  consistencyIssues: ConsistencyIssue[];
  createdAt: string;
}

export function toExtractionDto(
  row: Pick<
    ExtractionRow,
    "version" | "schemaVersion" | "source" | "content" | "consistencyIssues" | "createdAt"
  >,
): ExtractionVersionDto {
  return {
    version: row.version,
    schemaVersion: row.schemaVersion,
    source: row.source,
    content: row.content as unknown as SyllabusExtraction,
    consistencyIssues: row.consistencyIssues as unknown as ConsistencyIssue[],
    createdAt: row.createdAt.toISOString(),
  };
}
