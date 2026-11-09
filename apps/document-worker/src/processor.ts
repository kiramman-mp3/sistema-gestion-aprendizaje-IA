import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { documentTextJobSchema, type DocumentText } from "@smart-lms/contracts";
import { UnrecoverableError } from "bullmq";
import { DocumentError } from "./errors.js";
import type { ProgressReporter } from "./extract/common.js";
import { extractDocx } from "./extract/docx.js";
import { extractPdf } from "./extract/pdf.js";

export interface ProcessorDeps {
  storageDir: string;
  onProgress: ProgressReporter;
}

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
        ? await extractPdf(content, deps.onProgress)
        : await extractDocx(content, deps.onProgress);
    if (text.blocks.length === 0) throw new DocumentError("EMPTY_DOCUMENT");
    await deps.onProgress(100);
    return text;
  } catch (error) {
    if (error instanceof DocumentError) throw new UnrecoverableError(error.code);
    throw error;
  }
}
