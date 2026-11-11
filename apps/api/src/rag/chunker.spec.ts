import type { TextBlock } from "@smart-lms/contracts";
import { chunkDocument, DEFAULT_CHUNK_OPTIONS } from "./chunker";

const para = (text: string, page: number | null = 1): TextBlock => ({
  type: "paragraph",
  page,
  text,
});
const heading = (text: string, page: number | null = 1): TextBlock => ({
  type: "heading",
  page,
  level: 1,
  text,
});

const SMALL = { size: 100, overlap: 20, minChars: 10 };
const words = (n: number, prefix = "palabra") =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");

describe("chunkDocument", () => {
  it("un documento corto es un solo fragmento con su página", () => {
    const chunks = chunkDocument([
      heading("Evaluación"),
      para("Se evalúa con tres componentes de aprendizaje.", 2),
    ]);

    expect(chunks).toEqual([
      {
        index: 0,
        page: 1,
        content: "Evaluación Se evalúa con tres componentes de aprendizaje.",
      },
    ]);
  });

  it("un encabezado va con el texto que le sigue, no solo", () => {
    const chunks = chunkDocument(
      [para(words(12, "intro")), heading("Metodología"), para("Aprendizaje basado en proyectos")],
      {
        ...SMALL,
        size: 90,
      },
    );

    const withHeading = chunks.find((c) => c.content.includes("Metodología"));
    expect(withHeading?.content).toContain("Aprendizaje basado en proyectos");
  });

  it("parte un texto largo en fragmentos que no pasan del tamaño y terminan en palabra entera", () => {
    const chunks = chunkDocument([para(words(80))], SMALL);

    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(SMALL.size + SMALL.overlap);
      for (const word of chunk.content.split(" ")) expect(word).toMatch(/^palabra\d+$/);
    }
  });

  it("repite el final de un fragmento al inicio del siguiente, sin cortar palabras", () => {
    const chunks = chunkDocument([para(words(60))], SMALL);

    for (let i = 1; i < chunks.length; i++) {
      const lastWord = chunks[i - 1]!.content.split(" ").at(-1)!;
      expect(chunks[i]!.content).toContain(lastWord);
      expect(chunks[i]!.content.split(" ")[0]).toMatch(/^palabra\d+$/);
    }
  });

  it("no pierde ni repite texto: todas las palabras aparecen, en orden", () => {
    const text = words(50);
    const chunks = chunkDocument([para(text)], SMALL);

    const seen: string[] = [];
    for (const chunk of chunks) {
      for (const word of chunk.content.split(" ")) {
        if (!seen.includes(word)) seen.push(word);
      }
    }
    expect(seen.join(" ")).toBe(text);
  });

  it("cada fragmento lleva la página donde empieza su texto", () => {
    const chunks = chunkDocument(
      [para(words(14, "uno"), 1), para(words(14, "dos"), 2), para(words(14, "tres"), 3)],
      { size: 90, overlap: 0, minChars: 10 },
    );

    expect(chunks.map((c) => c.page)).toEqual([1, 2, 3]);
  });

  it("un documento sin páginas (DOCX) deja la página nula", () => {
    expect(
      chunkDocument([para("Texto de un documento de Word sin páginas.", null)])[0]?.page,
    ).toBeNull();
  });

  it("una tabla se lee fila por fila con las celdas separadas", () => {
    const chunks = chunkDocument([
      {
        type: "table",
        page: 1,
        rows: [
          ["Unidad", "Horas semanales"],
          ["Modelo relacional", "48 horas"],
        ],
      },
    ]);

    expect(chunks[0]?.content).toBe("Unidad | Horas semanales Modelo relacional | 48 horas");
  });

  it("descarta un fragmento demasiado corto", () => {
    expect(chunkDocument([para("Hola")])).toEqual([]);
    expect(chunkDocument([])).toEqual([]);
  });

  it("ignora los espacios y saltos de línea repetidos", () => {
    const chunks = chunkDocument([
      para("a  muy\n\n  buen   texto   de   ejemplo   para   el   fragmento"),
    ]);

    expect(chunks[0]?.content).toBe("a muy buen texto de ejemplo para el fragmento");
  });

  it("es determinista: el mismo documento da los mismos fragmentos", () => {
    const blocks = [heading("A"), para(words(70)), para(words(30, "otra"), 2)];

    expect(chunkDocument(blocks)).toEqual(chunkDocument(blocks));
  });

  it("los índices empiezan en 0 y no tienen huecos", () => {
    const chunks = chunkDocument([para(words(300))]);

    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    expect(DEFAULT_CHUNK_OPTIONS.size).toBe(900);
  });
});
