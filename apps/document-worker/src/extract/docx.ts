import type { DocumentText, TextBlock } from "@smart-lms/contracts";
import { XMLParser } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";
import { DocumentError } from "../errors.js";
import { normalizeText, type ProgressReporter } from "./common.js";

/** Límite por parte descomprimida; el backend ya rechaza paquetes que declaran más de 100 MB. */
export const MAX_DOCX_PART_BYTES = 50 * 1024 * 1024;
const DOCUMENT_PART = "word/document.xml";
const STYLES_PART = "word/styles.xml";

/** Nodo de fast-xml-parser con `preserveOrder`: una etiqueta con sus hijos, o `#text`. */
type XmlNode = Record<string, unknown> & { ":@"?: Record<string, string> };

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  // Los textos de Word solo usan las entidades XML básicas.
  htmlEntities: false,
  trimValues: false,
  parseTagValue: false,
});

/**
 * Extrae el texto de un DOCX: encabezados por estilo, párrafos y tablas en orden de lectura. Word no
 * guarda páginas; se estiman con los saltos que guardó al renderizar (`pagesApproximate`).
 */
export async function extractDocx(
  content: Uint8Array,
  onProgress: ProgressReporter = () => undefined,
): Promise<DocumentText> {
  const parts = unzipParts(content);
  const documentXml = parts.get(DOCUMENT_PART);
  if (!documentXml) throw new DocumentError("CORRUPT_DOCUMENT", "sin word/document.xml");

  const headingLevels = readHeadingStyles(parts.get(STYLES_PART));
  const body = findChildren(parseXml(documentXml), ["w:document", "w:body"]);
  const walker = new BodyWalker(headingLevels, documentXml.includes("w:lastRenderedPageBreak"));
  walker.walk(body);
  await onProgress(90);

  const hasPages = walker.sawPageMarker;
  return {
    pageCount: hasPages ? walker.page : null,
    pagesApproximate: true,
    ocr: false,
    // Las páginas son estimadas, pero el texto sale tal cual del documento.
    confidence: "high",
    blocks: hasPages ? walker.blocks : walker.blocks.map((block) => ({ ...block, page: null })),
  };
}

function unzipParts(content: Uint8Array): Map<string, string> {
  let files;
  try {
    files = unzipSync(content, {
      filter: (file) => {
        if (file.name !== DOCUMENT_PART && file.name !== STYLES_PART) return false;
        if (file.originalSize > MAX_DOCX_PART_BYTES) {
          throw new DocumentError("DOCUMENT_TOO_COMPLEX", `${file.name} demasiado grande`);
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof DocumentError) throw error;
    throw new DocumentError("CORRUPT_DOCUMENT", "ZIP inválido");
  }
  return new Map(Object.entries(files).map(([name, data]) => [name, strFromU8(data)]));
}

function parseXml(xml: string): XmlNode[] {
  // Un DOCX legítimo no declara DOCTYPE; rechazarlo evita ataques de expansión de entidades.
  if (/<!DOCTYPE/i.test(xml)) throw new DocumentError("CORRUPT_DOCUMENT", "DOCTYPE no permitido");
  try {
    return parser.parse(xml) as XmlNode[];
  } catch {
    throw new DocumentError("CORRUPT_DOCUMENT", "XML inválido");
  }
}

const tagOf = (node: XmlNode): string | undefined => Object.keys(node).find((key) => key !== ":@");
const childrenOf = (node: XmlNode): XmlNode[] => {
  const tag = tagOf(node);
  const value = tag ? node[tag] : undefined;
  return Array.isArray(value) ? (value as XmlNode[]) : [];
};
const attr = (node: XmlNode, name: string): string | undefined => node[":@"]?.[name];

function findChildren(nodes: XmlNode[], path: string[]): XmlNode[] {
  let current = nodes;
  for (const tag of path) {
    const next = current.find((node) => tagOf(node) === tag);
    if (!next) throw new DocumentError("CORRUPT_DOCUMENT", `sin ${tag}`);
    current = childrenOf(next);
  }
  return current;
}

/** Estilos de párrafo que son encabezados, con su nivel (1 a 6). */
function readHeadingStyles(stylesXml: string | undefined): Map<string, number> {
  const levels = new Map<string, number>();
  if (!stylesXml) return levels;
  for (const style of findChildren(parseXml(stylesXml), ["w:styles"])) {
    if (tagOf(style) !== "w:style" || attr(style, "w:type") !== "paragraph") continue;
    const id = attr(style, "w:styleId");
    if (!id) continue;
    const children = childrenOf(style);
    const name = attr(children.find((c) => tagOf(c) === "w:name") ?? {}, "w:val") ?? "";
    const properties = childrenOf(children.find((c) => tagOf(c) === "w:pPr") ?? {});
    const outline = attr(properties.find((c) => tagOf(c) === "w:outlineLvl") ?? {}, "w:val");

    const level =
      outline !== undefined
        ? Number(outline) + 1
        : /^title$/i.test(name)
          ? 1
          : Number(/^heading (\d)$/i.exec(name)?.[1] ?? Number.NaN);
    if (Number.isInteger(level) && level >= 1 && level <= 9) levels.set(id, Math.min(level, 6));
  }
  return levels;
}

class BodyWalker {
  readonly blocks: TextBlock[] = [];
  page = 1;
  sawPageMarker = false;
  /** Página donde apareció el primer texto del bloque actual: un salto puede ir antes o después. */
  private firstTextPage: number | undefined;

  /**
   * @param useRenderedBreaks Word guarda dónde cortó cada página al renderizar; si existen se usan
   *   esos y se ignoran los saltos manuales, que ya están incluidos en ellos.
   */
  constructor(
    private readonly headingLevels: Map<string, number>,
    private readonly useRenderedBreaks: boolean,
  ) {}

  walk(nodes: XmlNode[]): void {
    for (const node of nodes) {
      switch (tagOf(node)) {
        case "w:p":
          this.paragraph(node);
          break;
        case "w:tbl":
          this.table(node);
          break;
        case "w:sdt":
          this.walk(childrenOf(childrenOf(node).find((c) => tagOf(c) === "w:sdtContent") ?? {}));
          break;
      }
    }
  }

  private paragraph(node: XmlNode): void {
    this.firstTextPage = undefined;
    const text = normalizeText(this.textOf(childrenOf(node)));
    if (!text) return;
    const page = this.firstTextPage ?? this.page;
    const level = this.levelOf(node);
    this.blocks.push(
      level ? { type: "heading", page, level, text } : { type: "paragraph", page, text },
    );
  }

  private table(node: XmlNode): void {
    this.firstTextPage = undefined;
    const rows = childrenOf(node)
      .filter((row) => tagOf(row) === "w:tr")
      .map((row) =>
        childrenOf(row)
          .filter((cell) => tagOf(cell) === "w:tc")
          .map((cell) => normalizeText(this.textOf(childrenOf(cell), " "))),
      )
      .filter((cells) => cells.some((cell) => cell.length > 0));
    if (rows.length > 0)
      this.blocks.push({ type: "table", page: this.firstTextPage ?? this.page, rows });
  }

  private levelOf(paragraph: XmlNode): number | undefined {
    const properties = childrenOf(childrenOf(paragraph).find((c) => tagOf(c) === "w:pPr") ?? {});
    const outline = attr(properties.find((c) => tagOf(c) === "w:outlineLvl") ?? {}, "w:val");
    if (outline !== undefined && Number(outline) < 9) return Math.min(Number(outline) + 1, 6);
    const style = attr(properties.find((c) => tagOf(c) === "w:pStyle") ?? {}, "w:val");
    return style ? this.headingLevels.get(style) : undefined;
  }

  /** Texto de un nodo y sus descendientes; avanza la página al encontrar un salto. */
  private textOf(nodes: XmlNode[], paragraphSeparator = ""): string {
    let text = "";
    for (const node of nodes) {
      const tag = tagOf(node);
      if (tag === "#text") {
        text += String(node["#text"]);
      } else if (tag === "w:t") {
        const value = childrenOf(node)
          .map((c) => String(c["#text"] ?? ""))
          .join("");
        if (value.trim()) this.firstTextPage ??= this.page;
        text += value;
      } else if (tag === "w:tab") {
        text += " ";
      } else if (tag === "w:br") {
        if (attr(node, "w:type") === "page" && !this.useRenderedBreaks) this.nextPage();
        text += " ";
      } else if (tag === "w:lastRenderedPageBreak") {
        if (this.useRenderedBreaks) this.nextPage();
      } else if (tag === "w:p") {
        text += this.textOf(childrenOf(node)) + paragraphSeparator;
      } else if (
        tag &&
        !tag.startsWith("w:pPr") &&
        !tag.startsWith("w:rPr") &&
        tag !== "w:instrText"
      ) {
        // Corridas, hipervínculos, campos y controles de contenido contienen texto anidado.
        text += this.textOf(childrenOf(node), paragraphSeparator);
      }
    }
    return text;
  }

  private nextPage(): void {
    this.page += 1;
    this.sawPageMarker = true;
  }
}
