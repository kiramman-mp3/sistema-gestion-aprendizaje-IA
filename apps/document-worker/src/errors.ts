import type { DocumentTextErrorCode } from "@smart-lms/contracts";

/**
 * El documento no se puede procesar y reintentar no cambiaría nada. El código viaja como motivo del
 * fallo del trabajo y el backend lo guarda en `syllabus_documents.error_code`.
 */
export class DocumentError extends Error {
  constructor(
    readonly code: DocumentTextErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "DocumentError";
  }
}
