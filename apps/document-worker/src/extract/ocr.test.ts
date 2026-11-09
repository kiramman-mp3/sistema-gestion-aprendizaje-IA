import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { MAX_OCR_PAGES, TesseractPdfOcr, toParagraphs, type CommandRunner } from "./ocr.js";

/** Simula pdftoppm (crea la imagen) y tesseract (devuelve texto según la página). */
function fakeRunner(calls: string[][]): CommandRunner {
  return async (command, args) => {
    calls.push([command, ...args]);
    if (command === "pdftoppm" && args[0] === "-v") return "pdftoppm version 25";
    if (command === "tesseract" && args[0] === "--list-langs") return "List of languages:\nspa\n";
    if (command === "pdftoppm") {
      await writeFile(`${args.at(-1)}-0${args[5]}.png`, "imagen");
      return "";
    }
    const page = /page-(\d+)-/.exec(args[0] ?? "")?.[1];
    return `Unidad ${page}\nTexto escaneado\n\n\n  \n\nResultado RA${page}\n`;
  };
}

describe("TesseractPdfOcr", () => {
  it("rasteriza y reconoce solo las páginas pedidas, en español y sin shell", async () => {
    const calls: string[][] = [];
    const ocr = new TesseractPdfOcr(fakeRunner(calls));

    const blocks = await ocr.recognize(new Uint8Array([1]), [2, 3]);

    expect(blocks).toEqual([
      { type: "paragraph", page: 2, text: "Unidad 2 Texto escaneado" },
      { type: "paragraph", page: 2, text: "Resultado RA2" },
      { type: "paragraph", page: 3, text: "Unidad 3 Texto escaneado" },
      { type: "paragraph", page: 3, text: "Resultado RA3" },
    ]);
    expect(calls.filter((c) => c[0] === "pdftoppm").map((c) => c.slice(5, 9))).toEqual([
      ["-f", "2", "-l", "2"],
      ["-f", "3", "-l", "3"],
    ]);
    expect(calls.find((c) => c[0] === "tesseract")).toEqual(
      expect.arrayContaining(["stdout", "-l", "spa"]),
    );
  });

  it("detecta si los programas y el idioma están instalados", async () => {
    await expect(new TesseractPdfOcr(fakeRunner([])).isAvailable()).resolves.toBe(true);
    await expect(new TesseractPdfOcr(fakeRunner([]), "fra").isAvailable()).resolves.toBe(false);
    const missing: CommandRunner = async () => {
      throw new Error("ENOENT");
    };
    await expect(new TesseractPdfOcr(missing).isAvailable()).resolves.toBe(false);
  });

  it("rechaza documentos con demasiadas páginas escaneadas", async () => {
    const pages = Array.from({ length: MAX_OCR_PAGES + 1 }, (_, i) => i + 1);
    await expect(
      new TesseractPdfOcr(fakeRunner([])).recognize(new Uint8Array([1]), pages),
    ).rejects.toMatchObject({ code: "DOCUMENT_TOO_COMPLEX" });
  });
});

describe("toParagraphs", () => {
  it("descarta ruido sin letras ni números", () => {
    expect(toParagraphs(1, "— ~ |\n\nTema 1")).toEqual([
      { type: "paragraph", page: 1, text: "Tema 1" },
    ]);
  });
});
