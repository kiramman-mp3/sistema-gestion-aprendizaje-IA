import { documentTextSchema } from "@smart-lms/contracts";
import { describe, expect, it } from "vitest";
import { DocumentError } from "../errors.js";
import { buildPdf } from "../test-support/pdf.js";
import { extractPdf } from "./pdf.js";

const syllabus = buildPdf([
  [
    { text: "Sílabo de Ingeniería de Software", size: 18, y: 740 },
    { text: "Unidad 1: Requisitos", size: 14, y: 700 },
    { text: "Esta unidad presenta la elicitación", size: 11, y: 680 },
    { text: "y especificación de requisitos.", size: 11, y: 666 },
    { text: "Resultado de aprendizaje RA1.", size: 11, y: 630 },
  ],
  [
    { text: "Unidad 2: Diseño", size: 14, y: 740 },
    { text: "Patrones de diseño (GoF) y arquitectura.", size: 11, y: 720 },
  ],
]);

describe("extractPdf", () => {
  it("conserva páginas, encabezados con nivel y párrafos (RF-04)", async () => {
    const text = await extractPdf(syllabus);

    expect(documentTextSchema.parse(text)).toEqual(text);
    expect(text).toMatchObject({
      pageCount: 2,
      pagesApproximate: false,
      ocr: false,
      confidence: "high",
    });
    expect(text.blocks).toEqual([
      { type: "heading", page: 1, level: 1, text: "Sílabo de Ingeniería de Software" },
      { type: "heading", page: 1, level: 2, text: "Unidad 1: Requisitos" },
      {
        type: "paragraph",
        page: 1,
        text: "Esta unidad presenta la elicitación y especificación de requisitos.",
      },
      { type: "paragraph", page: 1, text: "Resultado de aprendizaje RA1." },
      { type: "heading", page: 2, level: 2, text: "Unidad 2: Diseño" },
      { type: "paragraph", page: 2, text: "Patrones de diseño (GoF) y arquitectura." },
    ]);
  });

  it("informa el avance por página", async () => {
    const progress: number[] = [];
    await extractPdf(syllabus, (percent) => void progress.push(percent));
    expect(progress).toEqual([45, 90]);
  });

  it("devuelve una lista vacía si el PDF no tiene capa de texto", async () => {
    const text = await extractPdf(buildPdf([[]]));
    expect(text.blocks).toEqual([]);
  });

  it("rechaza un PDF cifrado sin reintentar", async () => {
    const encrypted = buildPdf([[{ text: "secreto", size: 11, y: 700 }]], { encrypted: true });
    await expect(extractPdf(encrypted)).rejects.toMatchObject({
      name: "DocumentError",
      code: "ENCRYPTED_DOCUMENT",
    });
  });

  it("rechaza un archivo que no es un PDF válido", async () => {
    const error = await extractPdf(new TextEncoder().encode("%PDF-1.4 roto")).catch((e) => e);
    expect(error).toBeInstanceOf(DocumentError);
    expect(error.code).toBe("CORRUPT_DOCUMENT");
  });
});
