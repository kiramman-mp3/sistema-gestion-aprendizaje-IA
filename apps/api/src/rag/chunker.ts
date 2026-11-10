import type { TextBlock } from "@smart-lms/contracts";

/** Fragmento de un documento listo para indexar. */
export interface Chunk {
  /** Posición dentro del documento, desde 0. */
  index: number;
  /** Página del primer texto del fragmento; nula si el formato no tiene páginas. */
  page: number | null;
  content: string;
}

export interface ChunkOptions {
  /** Tamaño máximo de un fragmento, en caracteres. */
  size: number;
  /** Caracteres del final de un fragmento que se repiten al inicio del siguiente. */
  overlap: number;
  /** Un fragmento más corto que esto se descarta (un encabezado suelto no sirve para buscar). */
  minChars: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { size: 900, overlap: 120, minChars: 40 };

interface Segment {
  page: number | null;
  text: string;
}

const clean = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Texto de un bloque; una tabla se lee fila por fila con las celdas separadas por « | ». */
function segmentsOf(block: TextBlock): Segment[] {
  if (block.type === "table") {
    return block.rows
      .map((row) => clean(row.join(" | ")))
      .filter(Boolean)
      .map((text) => ({ page: block.page, text }));
  }
  const text = clean(block.text);
  return text ? [{ page: block.page, text }] : [];
}

/** Corta un texto más largo que `size` en trozos que terminan en un límite de palabra. */
function splitLong(text: string, size: number): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf(" ", size);
    if (cut < size / 2) cut = size;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** El final de `text`, de hasta `overlap` caracteres y empezando en una palabra entera. */
function tail(text: string, overlap: number): string {
  if (overlap <= 0 || text.length <= overlap) return overlap > 0 ? text : "";
  const from = text.length - overlap;
  const space = text.indexOf(" ", from);
  return space === -1 ? "" : text.slice(space + 1);
}

/**
 * Divide un documento en fragmentos de tamaño parecido, en orden de lectura y con solapamiento (RF-14). Un
 * encabezado se une al texto que le sigue, así que cada fragmento lleva el contexto de su sección. Es una función
 * pura: el mismo documento da siempre los mismos fragmentos, por eso reindexar es idempotente.
 */
export function chunkDocument(
  blocks: TextBlock[],
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): Chunk[] {
  const { size, overlap, minChars } = options;
  const segments = blocks
    .flatMap(segmentsOf)
    .flatMap((segment) =>
      splitLong(segment.text, size).map((text) => ({ page: segment.page, text })),
    );

  const chunks: Chunk[] = [];
  let buffer = "";
  let page: number | null = null;
  const flush = (): void => {
    const content = buffer.trim();
    if (content.length >= minChars) chunks.push({ index: chunks.length, page, content });
  };

  for (const segment of segments) {
    if (buffer && buffer.length + 1 + segment.text.length > size) {
      flush();
      const carried = tail(buffer, overlap);
      buffer = carried;
      // El solapamiento viene de la página anterior; el fragmento nuevo se atribuye a donde empieza su texto propio.
      page = segment.page;
    }
    if (!buffer) page = segment.page;
    buffer = buffer ? `${buffer} ${segment.text}` : segment.text;
  }
  flush();
  return chunks;
}
