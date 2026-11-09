import type { DocumentText, TextBlock } from "@smart-lms/contracts";
import {
  getDocument,
  InvalidPDFException,
  PasswordException,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { DocumentError } from "../errors.js";
import { normalizeText, type ProgressReporter } from "./common.js";

/** Un sílabo razonable tiene pocas decenas de páginas; más allá se considera un documento erróneo. */
export const MAX_PDF_PAGES = 300;
/** Un encabezado es al menos un 15 % más grande que el texto normal y es una línea corta. */
const HEADING_SIZE_RATIO = 1.15;
const MAX_HEADING_LENGTH = 120;
/** Separación vertical, en tamaños de letra, a partir de la cual empieza otro párrafo. */
const PARAGRAPH_GAP = 1.6;

interface Line {
  page: number;
  y: number;
  size: number;
  text: string;
}

interface RawItem {
  str: string;
  x: number;
  y: number;
  width: number;
  size: number;
}

/**
 * Extrae el texto de un PDF con su página. Los encabezados se reconocen por tamaño de letra. pdf.js
 * no reconstruye tablas: su contenido llega como párrafos (limitación documentada en ADR-003).
 */
export async function extractPdf(
  content: Uint8Array,
  onProgress: ProgressReporter = () => undefined,
): Promise<DocumentText> {
  const task = getDocument({
    // pdf.js transfiere el buffer a su worker y lo deja inutilizable: se le pasa una copia.
    data: new Uint8Array(content),
    // Solo texto: sin fuentes del sistema, sin formularios XFA y sin mensajes en consola.
    useSystemFonts: false,
    disableFontFace: true,
    enableXfa: false,
    verbosity: 0,
  });

  let document;
  try {
    document = await task.promise;
  } catch (error) {
    if (error instanceof PasswordException) throw new DocumentError("ENCRYPTED_DOCUMENT");
    if (error instanceof InvalidPDFException) throw new DocumentError("CORRUPT_DOCUMENT");
    throw error;
  }

  try {
    if (document.numPages > MAX_PDF_PAGES) {
      throw new DocumentError("DOCUMENT_TOO_COMPLEX", `${document.numPages} páginas`);
    }
    const lines: Line[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const items: RawItem[] = [];
      for (const item of textContent.items) {
        if (!("str" in item) || item.str.length === 0) continue;
        const [a, b, c, d, x, y] = item.transform as number[];
        items.push({
          str: item.str,
          x: x ?? 0,
          y: y ?? 0,
          width: item.width,
          size: Math.max(Math.hypot(a ?? 0, b ?? 0), Math.hypot(c ?? 0, d ?? 0), item.height),
        });
      }
      lines.push(...groupLines(pageNumber, items));
      page.cleanup();
      await onProgress(Math.round((pageNumber / document.numPages) * 90));
    }

    return {
      pageCount: document.numPages,
      pagesApproximate: false,
      ocr: false,
      confidence: "high",
      blocks: toBlocks(lines),
    };
  } finally {
    await task.destroy();
  }
}

/** Agrupa los fragmentos de una página en líneas, de arriba abajo y de izquierda a derecha. */
function groupLines(page: number, items: RawItem[]): Line[] {
  const sorted = [...items].sort((p, q) => q.y - p.y || p.x - q.x);
  const lines: { y: number; size: number; items: RawItem[] }[] = [];
  for (const item of sorted) {
    const line = lines.find((l) => Math.abs(l.y - item.y) <= Math.max(l.size, item.size) * 0.5);
    if (line) {
      line.items.push(item);
      line.size = Math.max(line.size, item.size);
    } else {
      lines.push({ y: item.y, size: item.size, items: [item] });
    }
  }

  return lines
    .sort((p, q) => q.y - p.y)
    .map((line) => {
      const parts = line.items.sort((p, q) => p.x - q.x);
      let text = "";
      let previousEnd: number | undefined;
      for (const part of parts) {
        const gap = previousEnd === undefined ? 0 : part.x - previousEnd;
        if (previousEnd !== undefined && gap > part.size * 0.15 && !/\s$/.test(text)) text += " ";
        text += part.str;
        previousEnd = part.x + part.width;
      }
      return { page, y: line.y, size: line.size, text: normalizeText(text) };
    })
    .filter((line) => line.text.length > 0);
}

function toBlocks(lines: Line[]): TextBlock[] {
  if (lines.length === 0) return [];
  const bodySize = typicalSize(lines);
  const isHeading = (line: Line) =>
    line.size >= bodySize * HEADING_SIZE_RATIO &&
    line.text.length <= MAX_HEADING_LENGTH &&
    /\p{L}/u.test(line.text);

  // Cada tamaño de encabezado distinto es un nivel; el más grande es el 1.
  const headingSizes = [...new Set(lines.filter(isHeading).map((l) => Math.round(l.size)))].sort(
    (p, q) => q - p,
  );
  const levelOf = (size: number) => Math.min(6, headingSizes.indexOf(Math.round(size)) + 1);

  const blocks: TextBlock[] = [];
  let paragraph: { page: number; lines: string[]; lastY: number; size: number } | undefined;
  const flush = () => {
    if (paragraph) {
      blocks.push({ type: "paragraph", page: paragraph.page, text: paragraph.lines.join(" ") });
    }
    paragraph = undefined;
  };

  for (const line of lines) {
    if (isHeading(line)) {
      flush();
      blocks.push({ type: "heading", page: line.page, level: levelOf(line.size), text: line.text });
      continue;
    }
    const continues =
      paragraph &&
      paragraph.page === line.page &&
      paragraph.lastY - line.y <= Math.max(paragraph.size, line.size) * PARAGRAPH_GAP;
    if (!continues) {
      flush();
      paragraph = { page: line.page, lines: [], lastY: line.y, size: line.size };
    }
    paragraph!.lines.push(line.text);
    paragraph!.lastY = line.y;
    paragraph!.size = line.size;
  }
  flush();
  return blocks;
}

/** Tamaño de letra más usado, ponderado por cantidad de caracteres: el del cuerpo del texto. */
function typicalSize(lines: Line[]): number {
  const weights = new Map<number, number>();
  for (const line of lines) {
    const size = Math.round(line.size);
    weights.set(size, (weights.get(size) ?? 0) + line.text.length);
  }
  return [...weights.entries()].sort((p, q) => q[1] - p[1])[0]![0];
}
