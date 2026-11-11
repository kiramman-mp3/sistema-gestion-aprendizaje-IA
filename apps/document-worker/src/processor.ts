import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { documentTextJobSchema, type DocumentText } from "@smart-lms/contracts";
import { UnrecoverableError } from "bullmq";
import { DocumentError } from "./errors.js";
import type { ProgressReporter } from "./extract/common.js";
import { extractDocx } from "./extract/docx.js";
import type { PdfOcr } from "./extract/ocr.js";
import { extractPdf } from "./extract/pdf.js";

export interface ProcessorDeps {
  storageDir: string;
  onProgress: ProgressReporter;
  /** Nulo si el OCR no está instalado: los PDF escaneados fallan con `EMPTY_DOCUMENT`. */
  ocr?: PdfOcr | null;
}

/** Una página con menos caracteres que esto se considera escaneada (sin capa de texto útil). */
export const MIN_PAGE_TEXT_CHARS = 20;

/**
 * Procesa un trabajo de `document-text`. Los errores del documento se lanzan como
 * `UnrecoverableError` con solo el código: BullMQ no reintenta y el backend guarda ese código. Los
 * demás errores (disco, memoria) se reintentan.
 */
export async function processDocumentJob(
  data: unknown,
  deps: ProcessorDeps,
): Promise<DocumentText> {
  const job = documentTextJobSchema.safeParse(data);
  if (!job.success) throw new UnrecoverableError("INVALID_JOB");

  // El esquema solo admite claves `carpeta/uuid.ext`, así que la ruta no sale del almacén.
  const content = new Uint8Array(await readFile(resolve(deps.storageDir, job.data.storageKey)));
  await deps.onProgress(5);

  try {
    const text =
      job.data.kind === "pdf"
        ? await withOcr(content, await extractPdf(content, deps.onProgress), deps.ocr)
        : await extractDocx(content, deps.onProgress);
    if (text.blocks.length === 0) throw new DocumentError("EMPTY_DOCUMENT");
    await deps.onProgress(100);
    return text;
  } catch (error) {
    if (error instanceof DocumentError) throw new UnrecoverableError(error.code);
    throw error;
  }
}

/**
 * Pasa por OCR las páginas sin texto (RF-04). Si alguna página salió de OCR, todo el documento se marca
 * con confianza baja para que el docente revise la extracción.
 */
async function withOcr(
  content: Uint8Array,
  text: DocumentText,
  ocr: PdfOcr | null | undefined,
): Promise<DocumentText> {
  if (!ocr || !text.pageCount) return text;
  const chars = new Map<number, number>();
  for (const block of text.blocks) {
    const length = block.type === "table" ? block.rows.flat().join("").length : block.text.length;
    if (block.page) chars.set(block.page, (chars.get(block.page) ?? 0) + length);
  }
  const scanned = Array.from({ length: text.pageCount }, (_, i) => i + 1).filter(
    (page) => (chars.get(page) ?? 0) < MIN_PAGE_TEXT_CHARS,
  );
  if (scanned.length === 0) return text;

  const recognized = await ocr.recognize(content, scanned);
  if (recognized.length === 0) return text;
  const blocks = [...text.blocks.filter((b) => !scanned.includes(b.page ?? 0)), ...recognized];
  // El orden de `sort` es estable: dentro de cada página se conserva el orden de lectura.
  blocks.sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
  return { ...text, ocr: true, confidence: "low", blocks };
}
