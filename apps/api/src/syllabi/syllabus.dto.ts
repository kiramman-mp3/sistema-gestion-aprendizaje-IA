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
  createdAt: string;
}

export function toSyllabusDto(
  document: Pick<
    SyllabusDocument,
    "id" | "moodleCourseId" | "filename" | "status" | "errorCode" | "createdAt"
  >,
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
    createdAt: document.createdAt.toISOString(),
  };
}
