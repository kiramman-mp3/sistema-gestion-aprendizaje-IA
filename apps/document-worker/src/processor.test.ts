import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnrecoverableError } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PdfOcr } from "./extract/ocr.js";
import { processDocumentJob } from "./processor.js";
import { buildDocx, p } from "./test-support/docx.js";
import { buildPdf } from "./test-support/pdf.js";

const ID = "0b6f3c8e-2a7d-4f43-9b1a-6f8e2d3c4b5a";
const EMPTY_ID = "1b6f3c8e-2a7d-4f43-9b1a-6f8e2d3c4b5a";
const MISSING_ID = "2b6f3c8e-2a7d-4f43-9b1a-6f8e2d3c4b5a";
const MIXED_ID = "3b6f3c8e-2a7d-4f43-9b1a-6f8e2d3c4b5a";

/** OCR simulado: reconoce un párrafo por página y anota qué páginas le pidieron. */
function fakeOcr(requested: number[][]): PdfOcr {
  return {
    recognize: async (_, pages) => {
      requested.push(pages);
      return pages.map((page) => ({ type: "paragraph", page, text: `Escaneado ${page}` }));
    },
  };
}

describe("processDocumentJob", () => {
  let storageDir: string;

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), "smart-lms-worker-"));
    await mkdir(join(storageDir, "syllabi"));
    const write = (name: string, content: Uint8Array) =>
      writeFile(join(storageDir, "syllabi", name), content);
    await write(`${ID}.pdf`, buildPdf([[{ text: "Unidad 1", size: 11, y: 700 }]]));
    await write(`${ID}.docx`, buildDocx(p("Unidad 1")));
    await write(`${EMPTY_ID}.pdf`, buildPdf([[]]));
    await write(
      `${MIXED_ID}.pdf`,
      buildPdf([[{ text: "Unidad 1: texto digital suficiente", size: 11, y: 700 }], [], []]),
    );
  });

  afterAll(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  const run = (data: unknown, progress: number[] = []) =>
    processDocumentJob(data, { storageDir, onProgress: (n) => void progress.push(n) });
  const job = (id: string, kind: "pdf" | "docx") => ({
    documentId: id,
    storageKey: `syllabi/${id}.${kind}`,
    kind,
  });

  it("procesa PDF y DOCX e informa el avance hasta 100", async () => {
    const progress: number[] = [];
    const pdf = await run(job(ID, "pdf"), progress);
    expect(pdf.blocks).toEqual([{ type: "paragraph", page: 1, text: "Unidad 1" }]);
    expect(progress).toEqual([5, 90, 100]);

    const docx = await run(job(ID, "docx"));
    expect(docx.blocks).toEqual([{ type: "paragraph", page: null, text: "Unidad 1" }]);
  });

  it("no reintenta un documento sin texto y devuelve solo el código", async () => {
    const error = await run(job(EMPTY_ID, "pdf")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect((error as Error).message).toBe("EMPTY_DOCUMENT");
  });

  it("rechaza trabajos mal formados, incluidas rutas fuera del almacén", async () => {
    await expect(
      run({ documentId: ID, storageKey: "../../etc/passwd", kind: "pdf" }),
    ).rejects.toThrow("INVALID_JOB");
  });

  it("deja reintentar errores transitorios, como un archivo que aún no aparece", async () => {
    const error = await run(job(MISSING_ID, "pdf")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
  });

  it("RF-04: aplica OCR a un PDF escaneado y lo marca con confianza baja", async () => {
    const requested: number[][] = [];
    const text = await processDocumentJob(job(EMPTY_ID, "pdf"), {
      storageDir,
      ocr: fakeOcr(requested),
      onProgress: () => undefined,
    });
    expect(requested).toEqual([[1]]);
    expect(text).toMatchObject({ ocr: true, confidence: "low" });
    expect(text.blocks).toEqual([{ type: "paragraph", page: 1, text: "Escaneado 1" }]);
  });

  it("solo pasa por OCR las páginas sin texto y conserva el orden por página", async () => {
    const requested: number[][] = [];
    const text = await processDocumentJob(job(MIXED_ID, "pdf"), {
      storageDir,
      ocr: fakeOcr(requested),
      onProgress: () => undefined,
    });
    expect(requested).toEqual([[2, 3]]);
    expect(text.blocks.map((b) => b.page)).toEqual([1, 2, 3]);
  });
});
