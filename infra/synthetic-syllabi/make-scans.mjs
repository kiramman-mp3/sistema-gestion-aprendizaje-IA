// Convierte los `*.source.pdf` de tests/fixtures/synthetic-syllabi en PDF escaneados (solo imagen, sin capa de texto),
// para probar el OCR del worker documental (RF-04).
//
//   node infra/synthetic-syllabi/make-scans.mjs [directorio]
//
// Rasteriza cada página con `pdftoppm` (Poppler) y arma un PDF cuyas páginas son JPEG. Para no instalar Poppler en
// Windows usa Docker (imagen alpine). Después se borra el `.source.pdf`.
// Para dejar el escaneo más parecido a uno real, la imagen se guarda a 130 ppp y en calidad JPEG media.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = resolve(process.argv[2] ?? join(root, "tests", "fixtures", "synthetic-syllabi"));
const DPI = 130;

/** Dimensiones de un JPEG baseline leyendo su marcador SOF. */
function jpegSize(bytes) {
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error("JPEG inválido");
    const marker = bytes[i + 1];
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
      };
    }
    i += 2 + length;
  }
  throw new Error("JPEG sin marcador SOF");
}

/** Un PDF cuyas páginas son una imagen JPEG a pantalla completa y sin ninguna capa de texto. */
function imagePdf(jpegs) {
  const objects = [];
  const add = (body) => objects.push(body) && objects.length;
  const catalog = add(Buffer.from(""));
  const pagesId = add(Buffer.from(""));
  const kids = [];
  for (const jpeg of jpegs) {
    const { width, height } = jpegSize(jpeg);
    const w = ((width / DPI) * 72).toFixed(2);
    const h = ((height / DPI) * 72).toFixed(2);
    const image = add(
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
          "latin1",
        ),
        jpeg,
        Buffer.from("\nendstream", "latin1"),
      ]),
    );
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    const contents = add(
      Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`, "latin1"),
    );
    kids.push(
      add(
        Buffer.from(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${contents} 0 R /Resources << /XObject << /Im0 ${image} 0 R >> >> >>`,
          "latin1",
        ),
      ),
    );
  }
  objects[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, "latin1");
  objects[pagesId - 1] = Buffer.from(
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`,
    "latin1",
  );
  const parts = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets = [];
  let length = parts[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, "latin1"),
      object,
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    parts.push(chunk);
    length += chunk.length;
  });
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}

const sources = readdirSync(dir).filter((name) => name.endsWith(".source.pdf"));
if (sources.length === 0) {
  console.log("No hay archivos *.source.pdf: nada que escanear.");
  process.exit(0);
}
// Un solo contenedor para todos. Los PDF de prueba usan Helvetica sin incrustarla, así que se instala una fuente
// metricamente compatible (Liberation Sans) en un Alpine descartable; la imagen del worker no trae fuentes.
const work = mkdtempSync(join(tmpdir(), "escaneo-"));
try {
  sources.forEach((name, i) =>
    writeFileSync(join(work, `s${i}.pdf`), readFileSync(join(dir, name))),
  );
  // Cada página queda como /work/s<N>-page-<P>.jpg.
  const script = [
    "apk add --no-cache -q poppler-utils font-liberation",
    `for f in /work/s*.pdf; do pdftoppm -jpeg -jpegopt quality=60 -r ${DPI} "$f" "$(echo "$f" | sed 's/[.]pdf$//')-page"; done`,
  ].join(" && ");
  execFileSync(
    "docker",
    ["run", "--rm", "-v", `${work}:/work`, "alpine:3.22.8", "sh", "-c", script],
    {
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, MSYS_NO_PATHCONV: "1" },
    },
  );
  sources.forEach((name, i) => {
    const pages = readdirSync(work)
      .filter((file) => file.startsWith(`s${i}-page`) && file.endsWith(".jpg"))
      .sort()
      .map((file) => readFileSync(join(work, file)));
    const target = join(dir, name.replace(".source.pdf", ".pdf"));
    writeFileSync(target, imagePdf(pages));
    rmSync(join(dir, name));
    console.log(`${name.replace(".source.pdf", ".pdf")}: ${pages.length} páginas`);
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}
