// Mide la calidad de la extracción de sílabos (IA-01 e IA-02 del plan de pruebas).
//
//   node infra/scripts/evaluate-extraction.mjs [directorio] [--check]
//
// El directorio (por defecto tests/fixtures/extraction-reference) contiene, por cada sílabo, dos archivos:
//   <nombre>.expected.json   la extracción correcta, revisada por un docente (esquema v1)
//   <nombre>.actual.json     lo que devolvió el sistema (GET /syllabi/:id/extraction, campo `content`)
// Ambos deben cumplir el esquema v1. No contienen datos personales reales.
//
// Imprime precisión, exhaustividad y F1 por categoría, con los conteos sumados de todos los sílabos (no el
// promedio de F1 por documento). Con --check termina con código 1 si unidades < 0.85 o resultados < 0.80.
// Requisito: `pnpm --filter @smart-lms/contracts build`.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { syllabusExtractionSchema, evaluateExtraction, aggregateEvaluations, EXTRACTION_TARGETS } =
  await import(pathToFileURL(join(root, "packages", "contracts", "dist", "index.js")).href);

const args = process.argv.slice(2);
const check = args.includes("--check");
const dir = resolve(
  args.find((arg) => !arg.startsWith("--")) ??
    join(root, "tests", "fixtures", "extraction-reference"),
);

const LABELS = {
  units: "Unidades (IA-01)",
  learningOutcomes: "Resultados de aprendizaje (IA-02)",
  activities: "Actividades",
};
const pct = (value) => (value === null ? "  n/d" : `${(value * 100).toFixed(1).padStart(5)}%`);

function load(file) {
  const parsed = syllabusExtractionSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) {
    const paths = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "(raíz)"))];
    throw new Error(`${file} no cumple el esquema v1: ${paths.join(", ")}`);
  }
  return parsed.data;
}

let files;
try {
  files = readdirSync(dir).filter((name) => name.endsWith(".expected.json"));
} catch {
  console.error(`No existe el directorio ${dir}.`);
  process.exit(2);
}
if (files.length === 0) {
  console.error(`No hay archivos *.expected.json en ${dir}.`);
  process.exit(2);
}

const evaluations = [];
for (const expectedName of files.sort()) {
  const name = expectedName.replace(/\.expected\.json$/, "");
  const evaluation = evaluateExtraction(
    load(join(dir, expectedName)),
    load(join(dir, `${name}.actual.json`)),
  );
  evaluations.push(evaluation);
  console.log(
    `${name}: unidades F1 ${pct(evaluation.units.f1)}, resultados F1 ${pct(evaluation.learningOutcomes.f1)}`,
  );
}

const total = aggregateEvaluations(evaluations);
console.log(`\nSílabos evaluados: ${evaluations.length}\n`);
console.log("Categoría                              VP   FP   FN   Precisión  Exhaustividad  F1");
let failed = false;
for (const [kind, label] of Object.entries(LABELS)) {
  const m = total[kind];
  const target = EXTRACTION_TARGETS[kind];
  const missed = target !== undefined && (m.f1 === null || m.f1 < target);
  failed ||= missed;
  console.log(
    `${label.padEnd(36)} ${String(m.tp).padStart(4)} ${String(m.fp).padStart(4)} ${String(m.fn).padStart(4)}   ${pct(m.precision)}     ${pct(m.recall)}      ${pct(m.f1)}` +
      (target === undefined ? "" : `  meta ≥ ${target * 100}% ${missed ? "NO CUMPLE" : "cumple"}`),
  );
}
process.exit(check && failed ? 1 : 0);
