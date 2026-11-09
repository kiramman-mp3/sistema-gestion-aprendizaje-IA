import type { SyllabusDocument } from "../generated/prisma/client";

/** `components/schemas/SyllabusDocument` del contrato OpenAPI. */
export interface SyllabusDocumentDto {
  id: string;
  courseId: number;
  filename: string;
  status: SyllabusDocument["status"];
  progress: number | null;
  errorCode: string | null;
  latestExtractionVersion: number | null;
  /** Páginas del documento; en DOCX son estimadas. */
  pageCount: number | null;
  /** `low` si el texto salió de OCR. Nulo hasta que el texto está extraído. */
  textConfidence: "high" | "low" | null;
  createdAt: string;
}

export function toSyllabusDto(
  document: Pick<
    SyllabusDocument,
    "id" | "moodleCourseId" | "filename" | "status" | "errorCode" | "createdAt"
  > &
    Partial<Pick<SyllabusDocument, "pageCount" | "extractedText">>,
  extra: { progress?: number | null; latestExtractionVersion?: number | null } = {},
): SyllabusDocumentDto {
  return {
    id: document.id,
    courseId: document.moodleCourseId,
    filename: document.filename,
    status: document.status,
    progress: extra.progress ?? null,
    errorCode: document.errorCode,
    latestExtractionVersion: extra.latestExtractionVersion ?? null,
    pageCount: document.pageCount ?? null,
    textConfidence: confidenceOf(document.extractedText),
    createdAt: document.createdAt.toISOString(),
  };
}

function confidenceOf(text: unknown): "high" | "low" | null {
  const confidence = (text as { confidence?: unknown } | null | undefined)?.confidence;
  return confidence === "high" || confidence === "low" ? confidence : null;
}
