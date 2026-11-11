import { strToU8, zipSync } from "fflate";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** Párrafo de Word; `style` es el id de estilo y `before` se inserta antes del texto. */
export function p(text: string, options: { style?: string; before?: string; after?: string } = {}) {
  const properties = options.style ? `<w:pPr><w:pStyle w:val="${options.style}"/></w:pPr>` : "";
  return `<w:p>${properties}<w:r>${options.before ?? ""}<w:t xml:space="preserve">${text}</w:t>${options.after ?? ""}</w:r></w:p>`;
}

export function table(rows: string[][]): string {
  const cells = (row: string[]) => row.map((cell) => `<w:tc>${p(cell)}</w:tc>`).join("");
  return `<w:tbl>${rows.map((row) => `<w:tr>${cells(row)}</w:tr>`).join("")}</w:tbl>`;
}

/** Estilos como los de Word en español: el id es local, el nombre interno es "heading N". */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Ttulo"><w:name w:val="Title"/></w:style>
<w:style w:type="paragraph" w:styleId="Ttulo1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="Ttulo2"><w:name w:val="heading 2"/></w:style>
<w:style w:type="paragraph" w:styleId="Destacado"><w:name w:val="Destacado"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr></w:style>
</w:styles>`;

export function buildDocx(body: string, extra: Record<string, string> = {}): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`,
    ),
    "word/styles.xml": strToU8(STYLES),
    ...Object.fromEntries(Object.entries(extra).map(([name, value]) => [name, strToU8(value)])),
  });
}
