import { describe, expect, it } from "vitest";
import { documentTextJobSchema, documentTextSchema } from "./text.js";

describe("documentTextJobSchema", () => {
  it("acepta claves del almacén y rechaza rutas arbitrarias", () => {
    const job = {
      documentId: "0b6f3c8e-2a7d-4f43-9b1a-6f8e2d3c4b5a",
      storageKey: "syllabi/0b6f3c8e-2a7d-4f43-9b1a-6f8e2d3c4b5a.pdf",
      kind: "pdf",
    };
    expect(documentTextJobSchema.parse(job)).toEqual(job);
    expect(
      documentTextJobSchema.safeParse({ ...job, storageKey: "../../etc/passwd" }).success,
    ).toBe(false);
  });
});

describe("documentTextSchema", () => {
  it("valida bloques de encabezado, párrafo y tabla", () => {
    const text = {
      pageCount: 2,
      pagesApproximate: false,
      ocr: false,
      confidence: "high",
      blocks: [
        { type: "heading", page: 1, level: 1, text: "Unidad 1" },
        { type: "paragraph", page: 1, text: "Introducción" },
        {
          type: "table",
          page: 2,
          rows: [
            ["Semana", "Tema"],
            ["1", "Requisitos"],
          ],
        },
      ],
    };
    expect(documentTextSchema.parse(text)).toEqual(text);
    expect(
      documentTextSchema.safeParse({ ...text, blocks: [{ type: "heading", page: 1, text: "x" }] })
        .success,
    ).toBe(false);
  });
});
