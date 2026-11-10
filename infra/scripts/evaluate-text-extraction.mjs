// Mide qué parte del contenido de un sílabo llega al texto que extrae el worker documental (RF-04).
//
//   node infra/scripts/evaluate-text-extraction.mjs [directorio] [--check]
//
// Es la capa que hay antes de la IA: si el texto no trae una unidad, un resultado de aprendizaje o un porcentaje,
// ningún modelo podrá extraerlo. Por cada sílabo del directorio (por defecto tests/fixtures/synthetic-syllabi) con su
// `.expected.json`, extrae el texto con el mismo código del worker (PDF y DOCX) y comprueba qué datos de la
// extracción esperada aparecen en él, sin importar mayúsculas, tildes ni espacios. No usa ningún modelo de IA.
// Los escaneados (`*.pdf` con `format: "scan"` en el manifiesto) necesitan OCR, que corre en la imagen del worker
// (Poppler y Tesseract): se omiten si no están disponibles en esta máquina.
//
// Con --check termina con código 1 si el recall total baja de 0.95. Los números de los sílabos sintéticos NO valen
// para la tesis; sirven para detectar que el worker deja de leer un formato o una estructura.
// Requisito: `pnpm --filter @smart-lms/document-worker build` y `pnpm --filter @smart-lms/contracts build`.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const dir = resolve(
  args.find((arg) => !arg.startsWith("--")) ?? join(root, "tests", "fixtures", "synthetic-syllabi"),
);
// En el contenedor del worker (con OCR) el código compilado y los contratos están en otras rutas.
const workerDist = process.env.WORKER_DIST ?? join(root, "apps", "document-worker", "dist");
const contractsEntry =
  process.env.CONTRACTS_ENTRY ?? join(root, "packages", "contracts", "dist", "index.js");
const dist = (...parts) => pathToFileURL(join(workerDist, ...parts)).href;
const { processDocumentJob } = await import(dist("processor.js"));
const { TesseractPdfOcr } = await import(dist("extract", "ocr.js"));
const { syllabusExtractionSchema } = await import(pathToFileURL(contractsEntry).href);

const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const ocr = new TesseractPdfOcr();
const storage = mkdtempSync(join(tmpdir(), "eval-silabos-"));
const ocrAvailable = await ocr.isAvailable();

/** Minúsculas, sin tildes ni signos y con los espacios colapsados. */
const norm = (text) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%/]+/g, " ")
    .trim();

const flatten = (text) =>
  norm(
    text.blocks
      .map((block) => (block.type === "table" ? block.rows.flat().join(" ") : block.text))
      .join(" "),
  );

/** Los datos de la extracción esperada que deben aparecer en el texto, por categoría. */
function facts(expected, spec) {
  const units = expected.gradingPeriods.flatMap((period) => period.units);
  return {
    "datos del curso": [
      expected.course.name,
      expected.course.code,
      expected.course.teacher,
      expected.course.period,
    ],
    "objetivo general": expected.course.generalObjective ? [expected.course.generalObjective] : [],
    unidades: units.map((unit) => unit.title),
    temas: units.flatMap((unit) => unit.topics),
    "resultados de aprendizaje": expected.learningOutcomes.map((outcome) => outcome.description),
    "porcentajes de evaluación": expected.assessmentInstruments.map((instrument) =>
      `${instrument.name} ${instrument.weight}%`.replace("%", ""),
    ),
    metodologías: expected.methodologies,
    fechas: spec.hasDates
      ? units
          .flatMap((unit) => [unit.startDate, unit.endDate])
          .map((date) => date.split("-").reverse().join("/"))
      : [],
    bibliografía: expected.bibliography.map((entry) => entry.split(". ")[1] ?? entry),
  };
}

const totals = {};
const perFormat = {};
let skipped = 0;
for (const spec of manifest.syllabi) {
  const file = join(dir, spec.file);
  if (!existsSync(file)) {
    console.log(`- ${spec.slug}: falta ${spec.file} (se omite)`);
    skipped += 1;
    continue;
  }
  if (spec.format === "scan" && !ocrAvailable) {
    console.log(`- ${spec.slug}: escaneado, requiere Poppler y Tesseract (se omite)`);
    skipped += 1;
    continue;
  }
  const expected = syllabusExtractionSchema.parse(
    JSON.parse(readFileSync(join(dir, `${spec.slug}.expected.json`), "utf8")),
  );
  // Pasa por el mismo procesador que el worker: lee el archivo del almacén y, si hay páginas sin texto, usa el OCR.
  const kind = spec.format === "docx" ? "docx" : "pdf";
  const storageKey = `eval/${randomUUID()}.${kind}`;
  mkdirSync(join(storage, "eval"), { recursive: true });
  writeFileSync(join(storage, storageKey), readFileSync(file));
  let text;
  try {
    text = await processDocumentJob(
      { documentId: randomUUID(), storageKey, kind },
      { storageDir: storage, onProgress: () => undefined, ocr: ocrAvailable ? ocr : null },
    );
  } catch (error) {
    console.log(`  FALLA ${spec.slug} (${spec.format}): ${error.message}`);
    totals.fallos = { found: 0, total: (totals.fallos?.total ?? 0) + 1 };
    continue;
  }
  const haystack = flatten(text);
  const missing = [];
  let found = 0;
  let total = 0;
  for (const [category, items] of Object.entries(facts(expected, spec))) {
    for (const item of items) {
      total += 1;
      const hit = haystack.includes(norm(item));
      if (hit) found += 1;
      else missing.push(`${category}: ${item}`);
      totals[category] ??= { found: 0, total: 0 };
      totals[category].total += 1;
      if (hit) totals[category].found += 1;
    }
  }
  perFormat[spec.format] ??= { found: 0, total: 0 };
  perFormat[spec.format].found += found;
  perFormat[spec.format].total += total;
  console.log(
    `${found === total ? "  ok " : "  FALTA"} ${spec.slug} (${spec.format}): ${found}/${total}${text.confidence === "low" ? " · confianza baja" : ""}`,
  );
  for (const item of missing.slice(0, 5)) console.log(`        no aparece → ${item}`);
}

const pct = ({ found, total }) => (total === 0 ? "n/d" : `${((found / total) * 100).toFixed(1)}%`);
console.log("\nRecall del texto extraído, por categoría:");
for (const [category, value] of Object.entries(totals)) {
  console.log(
    `  ${category.padEnd(28)} ${pct(value).padStart(6)}  (${value.found}/${value.total})`,
  );
}
console.log("\nPor formato:");
for (const [format, value] of Object.entries(perFormat)) {
  console.log(`  ${format.padEnd(28)} ${pct(value).padStart(6)}  (${value.found}/${value.total})`);
}
const all = Object.values(totals).reduce(
  (sum, value) => ({ found: sum.found + value.found, total: sum.total + value.total }),
  { found: 0, total: 0 },
);
console.log(
  `\nTotal: ${pct(all)} (${all.found}/${all.total})${skipped ? ` · ${skipped} sílabos omitidos` : ""}`,
);
console.log(
  "Estos números vienen de documentos sintéticos: sirven para vigilar el worker, no como métrica de la tesis.",
);
rmSync(storage, { recursive: true, force: true });
process.exit(check && all.total > 0 && all.found / all.total < 0.95 ? 1 : 0);
