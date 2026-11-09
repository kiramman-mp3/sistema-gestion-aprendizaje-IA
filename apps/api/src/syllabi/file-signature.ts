/** Tipos de documento aceptados como sílabo (RF-03). */
export type DocumentKind = "pdf" | "docx";

export const DOCUMENT_MIME_TYPES: Record<DocumentKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export type FileRejectionCode =
  | "EXTENSION_NOT_ALLOWED"
  | "MIME_MISMATCH"
  | "MACROS_NOT_ALLOWED"
  | "ARCHIVE_TOO_LARGE";

/** El archivo no es un PDF o DOCX válido. El mensaje se muestra al docente tal cual. */
export class FileRejectedError extends Error {
  constructor(
    readonly code: FileRejectionCode,
    message: string,
  ) {
    super(message);
    this.name = "FileRejectedError";
  }
}

/** Límite de lo que puede ocupar un DOCX descomprimido; evita bombas ZIP en el worker. */
export const MAX_DOCX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

const EXTENSIONS: Record<string, DocumentKind> = { ".pdf": "pdf", ".docx": "docx" };
const PDF_MAGIC = Buffer.from("%PDF-");
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
/** La especificación de PDF admite basura antes del encabezado; los lectores buscan en el primer KB. */
const PDF_HEADER_WINDOW = 1024;

/**
 * Decide el tipo del archivo por su contenido (magic bytes) y exige que coincida con la extensión.
 * El MIME que declara el navegador no se usa: lo controla el cliente.
 */
export function detectDocumentKind(filename: string, content: Buffer): DocumentKind {
  const extension = /\.[^.]+$/.exec(filename.toLowerCase())?.[0] ?? "";
  const expected = EXTENSIONS[extension];
  if (!expected) {
    throw new FileRejectedError(
      "EXTENSION_NOT_ALLOWED",
      "Solo se aceptan archivos PDF o DOCX.",
    );
  }

  const actual = sniff(content);
  if (actual !== expected) {
    throw new FileRejectedError(
      "MIME_MISMATCH",
      `El contenido del archivo no corresponde a un ${expected.toUpperCase()}.`,
    );
  }
  if (actual === "docx") checkDocxPackage(content);
  return actual;
}

function sniff(content: Buffer): DocumentKind | null {
  if (content.subarray(0, PDF_HEADER_WINDOW).includes(PDF_MAGIC)) return "pdf";
  if (content.subarray(0, 4).equals(ZIP_MAGIC)) {
    const names = new Set(readZipEntries(content).map((entry) => entry.name));
    if (names.has("[Content_Types].xml") && names.has("word/document.xml")) return "docx";
  }
  return null;
}

function checkDocxPackage(content: Buffer): void {
  const entries = readZipEntries(content);
  if (entries.some((entry) => /(^|\/)vbaProject\.bin$/i.test(entry.name))) {
    throw new FileRejectedError(
      "MACROS_NOT_ALLOWED",
      "El documento contiene macros. Guárdalo como DOCX sin macros.",
    );
  }
  const total = entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  if (total > MAX_DOCX_UNCOMPRESSED_BYTES) {
    throw new FileRejectedError(
      "ARCHIVE_TOO_LARGE",
      "El documento descomprimido es demasiado grande.",
    );
  }
}

interface ZipEntry {
  name: string;
  uncompressedSize: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
/** Registro final (22 bytes) más un comentario de hasta 64 KB. */
const EOCD_SEARCH_WINDOW = 22 + 0xffff;

/**
 * Lee los nombres y tamaños del directorio central de un ZIP sin descomprimir nada. Un ZIP dañado
 * devuelve una lista vacía, y el archivo se rechaza como tipo no válido.
 */
export function readZipEntries(content: Buffer): ZipEntry[] {
  const start = Math.max(0, content.length - EOCD_SEARCH_WINDOW);
  let eocd = -1;
  for (let offset = content.length - 22; offset >= start; offset--) {
    if (content.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) return [];

  const count = content.readUInt16LE(eocd + 10);
  let offset = content.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > content.length) return [];
    if (content.readUInt32LE(offset) !== CENTRAL_HEADER_SIGNATURE) return [];
    const uncompressedSize = content.readUInt32LE(offset + 24);
    const nameLength = content.readUInt16LE(offset + 28);
    const extraLength = content.readUInt16LE(offset + 30);
    const commentLength = content.readUInt16LE(offset + 32);
    const nameEnd = offset + 46 + nameLength;
    if (nameEnd > content.length) return [];
    entries.push({ name: content.toString("utf8", offset + 46, nameEnd), uncompressedSize });
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}
