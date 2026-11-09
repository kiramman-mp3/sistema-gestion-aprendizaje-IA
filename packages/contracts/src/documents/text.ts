import { z } from "zod";

/** Cola de BullMQ que procesa el worker documental (ADR-003, ADR-004). */
export const DOCUMENT_TEXT_QUEUE = "document-text";

/** Trabajo de extracción de texto. Solo referencias: el archivo se lee del almacén compartido. */
export const documentTextJobSchema = z.object({
  documentId: z.uuid(),
  storageKey: z.string().regex(/^[a-z0-9-]+\/[0-9a-f-]{36}\.(pdf|docx)$/),
  kind: z.enum(["pdf", "docx"]),
});
export type DocumentTextJob = z.infer<typeof documentTextJobSchema>;

/** Fragmento del documento en orden de lectura. `page` es nula si el formato no tiene páginas. */
export const textBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("heading"),
    page: z.number().int().positive().nullable(),
    level: z.number().int().min(1).max(6),
    text: z.string(),
  }),
  z.object({
    type: z.literal("paragraph"),
    page: z.number().int().positive().nullable(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("table"),
    page: z.number().int().positive().nullable(),
    rows: z.array(z.array(z.string())),
  }),
]);
export type TextBlock = z.infer<typeof textBlockSchema>;

/**
 * Resultado de la extracción (RF-04). `confidence` es `low` si el texto salió de OCR o si las
 * páginas son aproximadas.
 */
export const documentTextSchema = z.object({
  pageCount: z.number().int().nonnegative().nullable(),
  /** Las páginas de un DOCX se estiman con los saltos de página guardados por Word. */
  pagesApproximate: z.boolean(),
  ocr: z.boolean(),
  confidence: z.enum(["high", "low"]),
  blocks: z.array(textBlockSchema),
});
export type DocumentText = z.infer<typeof documentTextSchema>;

/** Error que el worker informa sin reintentar: el documento no se puede procesar. */
export const DOCUMENT_TEXT_ERROR_CODES = [
  "ENCRYPTED_DOCUMENT",
  "CORRUPT_DOCUMENT",
  "EMPTY_DOCUMENT",
  "DOCUMENT_TOO_COMPLEX",
] as const;
export type DocumentTextErrorCode = (typeof DOCUMENT_TEXT_ERROR_CODES)[number];
