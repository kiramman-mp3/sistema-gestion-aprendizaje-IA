// Genera los sílabos sintéticos de prueba (D-03 provisional) en tests/fixtures/synthetic-syllabi.
//
//   node infra/synthetic-syllabi/generate.mjs [--out directorio]
//
// Parte de la estructura de un programa analítico real (portada, información general, objetivos, contenido por
// unidades con horas y resultados de aprendizaje, metodología, evaluación por componentes, bibliografía y
// validación) pero TODO el contenido es ficticio: asignaturas genéricas, docentes, códigos, editoriales y
// libros inventados. El documento real que sirvió de modelo no se guarda en el repositorio.
//
// Por cada sílabo escribe `<nn>-<asignatura>.pdf|docx` y `<nn>-<asignatura>.expected.json`, la extracción correcta
// en el esquema v1 (lo que un extractor perfecto devolvería). Los PDF escaneados (imagen) se generan con
// `make-scans.mjs`, que necesita Poppler (pdftoppm), disponible en la imagen del worker documental.
// El resultado es determinista: se puede regenerar y debe quedar igual.
//
// IMPORTANTE: estos documentos sirven para ejercitar el flujo y medir la extracción de texto. Las métricas que
// salgan de ellos NO son válidas para la tesis: el F1 real se mide con los sílabos de la institución (D-03).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildDocx, p, table } from "../../apps/document-worker/src/test-support/docx.ts";
import { buildPdf } from "../../apps/document-worker/src/test-support/pdf.ts";
import { BOOKS, METHODOLOGIES, SUBJECTS, TEACHERS } from "./subjects.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const out = resolve(
  args[args.indexOf("--out") + 1] ?? join(root, "tests", "fixtures", "synthetic-syllabi"),
);

/** Variantes de cada sílabo: formato, porcentajes, fechas, borrador y errores de codificación. */
const WEIGHTS = [
  [40, 30, 30],
  [35, 35, 30],
  [30, 30, 40],
  [40, 30, 30],
  [50, 25, 25],
  [40, 40, 20],
];
const COMPONENTS = [
  "APRENDIZAJE EN CONTACTO CON EL DOCENTE",
  "APRENDIZAJE PRÁCTICO EXPERIMENTAL",
  "APRENDIZAJE AUTÓNOMO",
];
const PERIODS = ["JULIO 2026 - DICIEMBRE 2026", "ENERO 2027 - JUNIO 2027"];
const FORMATS = [
  "pdf",
  "pdf",
  "pdf",
  "pdf",
  "pdf",
  "pdf",
  "pdf",
  "pdf",
  "docx",
  "docx",
  "scan",
  "scan",
];
const WITH_DATES = new Set([2, 5, 8, 11]);
const MOJIBAKE = new Set([1, 6]);
const DRAFT = new Set([0, 3, 6, 9]);

const pad = (n) => String(n).padStart(2, "0");
const iso = (date) => date.toISOString().slice(0, 10);
const latin = (date) =>
  `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
const addDays = (date, days) => new Date(date.getTime() + days * 86_400_000);
/** Simula el error de codificación (UTF-8 leído como Latin-1) que trae la bibliografía de documentos reales. */
const mojibake = (text) => Buffer.from(text, "utf8").toString("latin1");

function buildSpec(subject, index) {
  const period = PERIODS[index % 2];
  const totalHours = [192, 144, 96][index % 3];
  const hoursPerUnit = Math.round(totalHours / subject.units.length);
  const weights = WEIGHTS[index % WEIGHTS.length];
  const start = new Date(Date.UTC(index % 2 === 0 ? 2026 : 2027, index % 2 === 0 ? 7 : 0, 3));
  const units = subject.units.map((unit, i) => {
    const begins = addDays(start, i * 28);
    return {
      ...unit,
      number: i + 1,
      hours: hoursPerUnit,
      outcomeId: `RA${i + 1}`,
      startDate: WITH_DATES.has(index) ? begins : null,
      endDate: WITH_DATES.has(index) ? addDays(begins, 24) : null,
    };
  });
  const books = [0, 1, 2, 3, 4, 5]
    .slice(0, 3 + (index % 3))
    .map((n) => BOOKS[(n + index) % BOOKS.length]);
  const fixAuthor = (book, i) =>
    MOJIBAKE.has(index) && i === 0 ? { ...book, authors: mojibake(book.authors) } : book;
  return {
    index,
    slug: `${pad(index + 1)}-${subject.slug}`,
    format: FORMATS[index],
    draft: DRAFT.has(index),
    name: subject.name,
    level: subject.level,
    code: `UAF-FCI-SF-MP-UP-${pad(index + 1)}-01`,
    period,
    teacher: TEACHERS[index % TEACHERS.length].toUpperCase(),
    objective: subject.objective,
    units,
    totalHours,
    weights,
    methodologies: METHODOLOGIES.slice(0, 3 + (index % 3)),
    books: books.map(fixAuthor),
  };
}

const bookLine = (b) => `${b.authors} (${b.year}). ${b.title}. ${b.publisher}.`;

/** Líneas del documento, en el orden de un programa analítico. `kind`: title, h1, h2, body. */
function lines(spec) {
  const l = [];
  const add = (kind, text) => l.push({ kind, text });
  add("title", "UNIVERSIDAD ANDINA FICTICIA");
  add("body", "FACULTAD DE: CIENCIAS DE LA INGENIERIA (INSTITUCION FICTICIA PARA PRUEBAS)");
  add("body", "CARRERA DE: Software        MODALIDAD PRESENCIAL");
  add("title", `PROGRAMA ANALITICO ${spec.name}`);
  add("body", `NIVEL ${spec.level}    ${spec.period}`);
  add("body", spec.teacher);
  add("body", "Documento sintetico generado para pruebas. No describe un curso real.");
  add("pagebreak");
  add("h1", "I. INFORMACIÓN GENERAL");
  add("body", `Nombre de la asignatura: ${spec.name}`);
  add("body", `Código: ${spec.code}`);
  add("body", `Nivel: ${spec.level}    Créditos/Horas: 4`);
  add("body", `Total de horas de aprendizaje en el ciclo: ${spec.totalHours}`);
  add("h1", "II. OBJETIVOS");
  if (spec.objective) {
    add("h2", "Objetivo general de la asignatura");
    add("body", spec.objective);
  }
  add("h2", "Objetivos específicos de la asignatura");
  spec.units.forEach((u) => add("body", `${u.number}.- ${u.outcome}`));
  add("h1", "III. CONTENIDO");
  spec.units.forEach((u) => {
    add("h2", `U.${u.number} ${u.title} (${u.hours} horas)`);
    add("body", `Contenidos mínimos: ${u.topics.join("; ")}.`);
    add("body", `Resultado de aprendizaje: ${u.outcome}.`);
    if (u.startDate) add("body", `Periodo: del ${latin(u.startDate)} al ${latin(u.endDate)}.`);
  });
  add("body", `Total de horas: ${spec.totalHours}`);
  add("h1", "IV. METODOLOGÍA");
  add(
    "body",
    "Se aplicarán los métodos, técnicas y estrategias siguientes, con evaluación continua y formativa:",
  );
  spec.methodologies.forEach((m) => add("body", `- ${m}`));
  add("h1", "V. PROCEDIMIENTOS DE EVALUACIÓN");
  COMPONENTS.forEach((c, i) => add("body", `${c}: ${spec.weights[i]}%`));
  add("h1", "VI. BIBLIOGRAFÍA");
  add("h2", "BIBLIOGRAFÍA BÁSICA");
  spec.books
    .slice(0, 2)
    .forEach((b) =>
      add("body", `${b.authors}   ${b.year}   ${b.title}   ${b.publisher}   ${b.kind}`),
    );
  add("h2", "BIBLIOGRAFÍA COMPLEMENTARIA");
  spec.books
    .slice(2)
    .forEach((b) =>
      add("body", `${b.authors}   ${b.year}   ${b.title}   ${b.publisher}   ${b.kind}`),
    );
  add("h1", "VII. VALIDACIÓN DEL PROGRAMA ANALÍTICO");
  add("body", "Fecha de elaboración: 31 de julio de 2026");
  if (spec.draft) add("body", "Borrador");
  return l;
}

const SIZES = { title: 16, h1: 14, h2: 12, body: 10 };
const LINE_HEIGHT = { title: 22, h1: 20, h2: 17, body: 14 };
const WRAP = 88;

function wrap(text, width) {
  const words = text.split(/\s+/);
  const rows = [];
  let row = "";
  for (const word of words) {
    if (row && (row + " " + word).length > width) {
      rows.push(row);
      row = word;
    } else {
      row = row ? `${row} ${word}` : word;
    }
  }
  if (row) rows.push(row);
  return rows;
}

function buildPdfFor(spec) {
  const pages = [[]];
  let y = 720;
  const page = () => pages.at(-1);
  for (const { kind, text } of lines(spec)) {
    if (kind === "pagebreak") {
      pages.push([]);
      y = 720;
      continue;
    }
    const size = SIZES[kind];
    for (const row of wrap(text, Math.floor(WRAP * (10 / size)))) {
      if (y < 72) {
        pages.push([]);
        y = 720;
      }
      page().push({ text: row, size, y });
      y -= LINE_HEIGHT[kind];
    }
    if (kind !== "body") y -= 2;
  }
  // Pie de página con el número, como en los documentos institucionales.
  pages.forEach((runs, i) =>
    runs.push({ text: `Pagina ${i + 1}/${pages.length}`, size: 8, y: 40 }),
  );
  return buildPdf(pages);
}

const esc = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function buildDocxFor(spec) {
  const body = [];
  const rows = lines(spec);
  for (let i = 0; i < rows.length; i += 1) {
    const { kind, text } = rows[i];
    if (kind === "pagebreak") continue;
    if (text === "III. CONTENIDO") {
      body.push(p(esc(text), { style: "Ttulo1" }));
      // Las unidades van en una tabla, como en el documento institucional.
      body.push(
        table([
          [
            "Unidad",
            "Contenidos mínimos",
            "Horas",
            "Resultado de aprendizaje",
            ...(spec.units[0].startDate ? ["Periodo"] : []),
          ],
          ...spec.units.map((u) => [
            esc(`U.${u.number} ${u.title}`),
            esc(u.topics.join("; ")),
            String(u.hours),
            esc(u.outcome),
            ...(u.startDate ? [`del ${latin(u.startDate)} al ${latin(u.endDate)}`] : []),
          ]),
        ]),
      );
      // Salta las líneas por unidad que ya están en la tabla.
      while (rows[i + 1] && !rows[i + 1].text.startsWith("Total de horas:")) i += 1;
      continue;
    }
    const style =
      kind === "title" ? "Ttulo" : kind === "h1" ? "Ttulo1" : kind === "h2" ? "Ttulo2" : undefined;
    body.push(p(esc(text), { style }));
  }
  return buildDocx(body.join(""));
}

/** La extracción correcta, en el esquema v1. */
function expectedFor(spec) {
  const uncertain = [];
  if (!spec.objective)
    uncertain.push({ path: "course.generalObjective", reason: "missing", note: null });
  return {
    schemaVersion: "1.0",
    course: {
      name: spec.name,
      code: spec.code,
      period: spec.period,
      teacher: spec.teacher,
      generalObjective: spec.objective,
    },
    learningOutcomes: spec.units.map((u) => ({ id: u.outcomeId, description: u.outcome })),
    gradingPeriods: [
      {
        name: spec.period,
        weight: null,
        units: spec.units.map((u) => ({
          title: u.title,
          topics: u.topics,
          learningOutcomeIds: [u.outcomeId],
          startDate: u.startDate ? iso(u.startDate) : null,
          endDate: u.endDate ? iso(u.endDate) : null,
          activities: [],
        })),
      },
    ],
    methodologies: spec.methodologies,
    resources: [],
    assessmentInstruments: COMPONENTS.map((name, i) => ({ name, weight: spec.weights[i] })),
    bibliography: spec.books.map(bookLine),
    uncertainFields: uncertain,
    sourceReferences: [],
  };
}

// Cada extracción esperada debe cumplir el esquema v1 y no tener incoherencias internas.
const { syllabusExtractionSchema, findConsistencyIssues } = await import(
  pathToFileURL(join(root, "packages", "contracts", "dist", "index.js")).href
);
const check = (spec) => {
  const expected = expectedFor(spec);
  const parsed = syllabusExtractionSchema.safeParse(expected);
  if (!parsed.success) {
    throw new Error(
      `${spec.slug}: la extracción esperada no cumple el esquema v1: ${parsed.error.message}`,
    );
  }
  const issues = findConsistencyIssues(parsed.data);
  if (issues.length > 0) {
    throw new Error(
      `${spec.slug}: la extracción esperada tiene incoherencias: ${JSON.stringify(issues)}`,
    );
  }
};

mkdirSync(out, { recursive: true });
const manifest = [];
SUBJECTS.forEach((subject, index) => {
  const spec = buildSpec(subject, index);
  check(spec);
  const base = join(out, spec.slug);
  // Los escaneados parten de un PDF de texto, que `make-scans.mjs` convierte en imagen.
  const extension = spec.format === "docx" ? "docx" : "pdf";
  const file = spec.format === "scan" ? `${base}.source.pdf` : `${base}.${extension}`;
  writeFileSync(file, spec.format === "docx" ? buildDocxFor(spec) : buildPdfFor(spec));
  writeFileSync(`${base}.expected.json`, `${JSON.stringify(expectedFor(spec), null, 2)}\n`);
  manifest.push({
    slug: spec.slug,
    file: spec.format === "scan" ? `${spec.slug}.pdf` : `${spec.slug}.${extension}`,
    format: spec.format,
    units: spec.units.length,
    weights: spec.weights,
    hasDates: WITH_DATES.has(index),
    hasGeneralObjective: Boolean(spec.objective),
    encodingErrorsInBibliography: MOJIBAKE.has(index),
    draft: spec.draft,
  });
});
writeFileSync(
  join(out, "manifest.json"),
  `${JSON.stringify({ synthetic: true, syllabi: manifest }, null, 2)}\n`,
);
console.log(`${manifest.length} sílabos sintéticos en ${out}`);
