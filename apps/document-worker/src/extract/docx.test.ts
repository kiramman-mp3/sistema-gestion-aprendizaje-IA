import { documentTextSchema } from "@smart-lms/contracts";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildDocx, p, table } from "../test-support/docx.js";
import { extractDocx } from "./docx.js";

describe("extractDocx", () => {
  it("reconoce encabezados por estilo, párrafos y tablas en orden", async () => {
    const docx = buildDocx(
      [
        p("Sílabo de Bases de Datos", { style: "Ttulo" }),
        p("Unidad 1: Modelo relacional", { style: "Ttulo1" }),
        p("Álgebra relacional &amp; SQL básico."),
        p("Evaluación", { style: "Ttulo2" }),
        table([
          ["Actividad", "Peso"],
          ["Examen parcial", "30 %"],
        ]),
        p("Nota importante", { style: "Destacado" }),
        p("   "),
      ].join(""),
    );

    const text = await extractDocx(docx);
    expect(documentTextSchema.parse(text)).toEqual(text);
    expect(text).toMatchObject({ pageCount: null, pagesApproximate: true, ocr: false });
    expect(text.blocks).toEqual([
      { type: "heading", page: null, level: 1, text: "Sílabo de Bases de Datos" },
      { type: "heading", page: null, level: 1, text: "Unidad 1: Modelo relacional" },
      { type: "paragraph", page: null, text: "Álgebra relacional & SQL básico." },
      { type: "heading", page: null, level: 2, text: "Evaluación" },
      {
        type: "table",
        page: null,
        rows: [
          ["Actividad", "Peso"],
          ["Examen parcial", "30 %"],
        ],
      },
      { type: "heading", page: null, level: 3, text: "Nota importante" },
    ]);
  });

  it("estima las páginas con los saltos que guardó Word", async () => {
    const docx = buildDocx(
      [
        p("Página uno", { after: '<w:br w:type="page"/>' }),
        p("Página dos", { before: "<w:lastRenderedPageBreak/>" }),
        p("Sigue en dos"),
        p("Página tres", { before: "<w:lastRenderedPageBreak/>" }),
      ].join(""),
    );
    const text = await extractDocx(docx);
    expect(text.pageCount).toBe(3);
    expect(text.blocks.map((b) => b.page)).toEqual([1, 2, 2, 3]);
  });

  it("usa los saltos manuales si Word no guardó los renderizados", async () => {
    const docx = buildDocx([p("Uno", { after: '<w:br w:type="page"/>' }), p("Dos")].join(""));
    const text = await extractDocx(docx);
    expect(text.blocks.map((b) => b.page)).toEqual([1, 2]);
  });

  it("rechaza un ZIP sin documento de Word o dañado", async () => {
    const zip = zipSync({ "otro.xml": strToU8("<a/>") });
    await expect(extractDocx(zip)).rejects.toMatchObject({ code: "CORRUPT_DOCUMENT" });
    await expect(extractDocx(strToU8("PK no es zip"))).rejects.toMatchObject({
      code: "CORRUPT_DOCUMENT",
    });
  });

  it("rechaza XML con DOCTYPE para evitar la expansión de entidades", async () => {
    const bomb = zipSync({
      "word/document.xml": strToU8(
        '<?xml version="1.0"?><!DOCTYPE lol [<!ENTITY lol "lol">]><w:document><w:body/></w:document>',
      ),
    });
    await expect(extractDocx(bomb)).rejects.toMatchObject({ code: "CORRUPT_DOCUMENT" });
  });
});
