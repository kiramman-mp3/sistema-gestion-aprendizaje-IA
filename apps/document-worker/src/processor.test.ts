import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnrecoverableError } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processDocumentJob } from "./processor.js";
import { buildDocx, p } from "./test-support/docx.js";
import { buildPdf } from "./test-support/pdf.js";

const ID = "0b6f3c8e-2a7d-4f43-9b1a-6f8e2d3c4b5a";
const EMPTY_ID = "1b6f3c8e-2a7d-4f43-9b1a-6f8e2d3c4b5a";
const MISSING_ID = "2b6f3c8e-2a7d-4f43-9b1a-6f8e2d3c4b5a";

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
});
