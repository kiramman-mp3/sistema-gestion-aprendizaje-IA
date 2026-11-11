import { buildZip, minimalDocx, minimalPdf } from "../../test/support/documents";
import {
  detectDocumentKind,
  FileRejectedError,
  MAX_DOCX_UNCOMPRESSED_BYTES,
  readZipEntries,
} from "./file-signature";

function rejectionCode(filename: string, content: Buffer): string | undefined {
  try {
    detectDocumentKind(filename, content);
    return undefined;
  } catch (error) {
    return error instanceof FileRejectedError ? error.code : "OTHER";
  }
}

describe("detectDocumentKind", () => {
  it("acepta un PDF y un DOCX reales sin importar mayúsculas en la extensión", () => {
    expect(detectDocumentKind("silabo.pdf", minimalPdf())).toBe("pdf");
    expect(detectDocumentKind("Sílabo.DOCX", minimalDocx())).toBe("docx");
  });

  it("acepta un PDF con bytes antes del encabezado", () => {
    const content = Buffer.concat([Buffer.alloc(100, 0x20), minimalPdf()]);
    expect(detectDocumentKind("silabo.pdf", content)).toBe("pdf");
  });

  it("rechaza extensiones que no son PDF ni DOCX", () => {
    expect(rejectionCode("silabo.doc", minimalDocx())).toBe("EXTENSION_NOT_ALLOWED");
    expect(rejectionCode("silabo.exe", Buffer.from("MZ"))).toBe("EXTENSION_NOT_ALLOWED");
    expect(rejectionCode("silabo", minimalPdf())).toBe("EXTENSION_NOT_ALLOWED");
  });

  it("rechaza archivos con extensión falsa (FUN-02)", () => {
    expect(rejectionCode("silabo.pdf", Buffer.from("MZ\x90\x00 ejecutable"))).toBe("MIME_MISMATCH");
    expect(rejectionCode("silabo.pdf", minimalDocx())).toBe("MIME_MISMATCH");
    expect(rejectionCode("silabo.docx", minimalPdf())).toBe("MIME_MISMATCH");
    expect(rejectionCode("silabo.docx", Buffer.from("texto plano"))).toBe("MIME_MISMATCH");
  });

  it("rechaza un ZIP que no es un documento de Word", () => {
    const zip = buildZip([{ name: "xl/workbook.xml", content: "<workbook/>" }]);
    expect(rejectionCode("silabo.docx", zip)).toBe("MIME_MISMATCH");
  });

  it("rechaza documentos con macros", () => {
    const docm = minimalDocx("x", [{ name: "word/vbaProject.bin", content: "macro" }]);
    expect(rejectionCode("silabo.docx", docm)).toBe("MACROS_NOT_ALLOWED");
  });

  it("rechaza un DOCX que declara un tamaño descomprimido excesivo", () => {
    const docx = minimalDocx();
    const entries = readZipEntries(docx);
    expect(entries).toHaveLength(2);

    // Simula una bomba ZIP: el directorio central declara un tamaño enorme para document.xml.
    const name = Buffer.from("word/document.xml");
    const centralSignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    const firstHeader = docx.indexOf(centralSignature);
    const secondHeader = docx.indexOf(centralSignature, firstHeader + 4);
    expect(docx.subarray(secondHeader + 46, secondHeader + 46 + name.length)).toEqual(name);
    docx.writeUInt32LE(MAX_DOCX_UNCOMPRESSED_BYTES + 1, secondHeader + 24);

    expect(rejectionCode("silabo.docx", docx)).toBe("ARCHIVE_TOO_LARGE");
  });
});

describe("readZipEntries", () => {
  it("devuelve una lista vacía para un ZIP dañado o un archivo corto", () => {
    expect(readZipEntries(Buffer.from("PK\x03\x04"))).toEqual([]);
    const zip = minimalDocx();
    expect(readZipEntries(zip.subarray(0, zip.length - 30))).toEqual([]);
  });
});
