/** Texto de prueba ubicado en una página: tamaño de letra y altura desde abajo, en puntos. */
export interface PdfRun {
  text: string;
  size: number;
  y: number;
  x?: number;
}

const escape = (text: string) => text.replace(/([\\()])/g, "\\$1");

/**
 * Construye un PDF de varias páginas con Helvetica y codificación WinAnsi (admite tildes y ñ).
 * `encrypted` añade un diccionario /Encrypt cuya contraseña de usuario no es vacía.
 */
export function buildPdf(pages: PdfRun[][], options: { encrypted?: boolean } = {}): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 1;

  const catalog = add("");
  const pagesId = add("");
  const font = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  const kids: number[] = [];
  for (const runs of pages) {
    const stream = runs
      .map((r) => `BT /F1 ${r.size} Tf ${r.x ?? 72} ${r.y} Td (${escape(r.text)}) Tj ET`)
      .join("\n");
    const contents = add(
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    );
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${contents} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  const encrypt = options.encrypted
    ? add(`<< /Filter /Standard /V 1 /R 2 /O <${"ab".repeat(32)}> /U <${"cd".repeat(32)}> /P -4 >>`)
    : undefined;

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  const extra = encrypt
    ? ` /Encrypt ${encrypt} 0 R /ID [<${"01".repeat(16)}> <${"01".repeat(16)}>]`
    : "";
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${extra} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, "latin1"));
}
