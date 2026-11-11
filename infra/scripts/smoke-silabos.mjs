// Verificación de punta a punta de CU-01 (carga y extracción de sílabos) con el backend, ClamAV, el worker documental,
// Redis, PostgreSQL y Moodle reales.
//
//   node infra/scripts/smoke-silabos.mjs
//
// Requisitos (entorno local, ver docs/desarrollo/entorno-local.md):
//   - `WORKER_STORAGE_SOURCE=./apps/api/var/storage docker compose --profile antivirus --profile worker up -d`
//   - El backend con el proveedor de demostración: `AI_PROVIDER=mock pnpm --filter @smart-lms/api dev`.
//   - Moodle con el curso de prueba (`seed_curso_prueba.php`) y los sílabos sintéticos (`pnpm synthetic:syllabi`).
//
// Qué hace: con `prueba_docente` y el curso AN-401-PRUEBA, sube cada sílabo sintético (PDF, DOCX y escaneados),
// espera la extracción de texto del worker, pide la extracción con el proveedor de demostración (que devuelve el
// sílabo de ejemplo) y comprueba el esquema v1. También prueba los rechazos: archivo repetido, extensión falsa,
// DOCX con macros, PDF cifrado, archivo vacío y un archivo de prueba del antivirus (EICAR). Al final borra
// todo lo que creó en la base y en el almacén.
// Las extracciones salen del proveedor de demostración: no miden calidad de IA.
// Termina con código 0 si todas las comprobaciones pasan.
import { execFileSync } from "node:child_process";
import net from "node:net";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildDocx } from "../../apps/document-worker/src/test-support/docx.ts";
import { buildPdf } from "../../apps/document-worker/src/test-support/pdf.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
const BASE = `http://localhost:${env.PORT ?? 3000}/api/v1`;
const MOODLE_URL = "http://localhost:8000";
const FIXTURES = join(root, "tests", "fixtures", "synthetic-syllabi");
const { syllabusExtractionSchema } = await import(
  pathToFileURL(join(root, "packages", "contracts", "dist", "index.js")).href
);

const php = (code) =>
  execFileSync("bash", ["infra/scripts/moodle.sh", "compose", "exec", "-T", "webserver", "php"], {
    cwd: root,
    input: `<?php define('CLI_SCRIPT', true); require '/var/www/html/config.php'; ${code}`,
    encoding: "utf8",
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  })
    .split("\n")
    .filter((line) => !line.startsWith("Including local options"))
    .join("\n")
    .trim();
const sql = (statement) =>
  execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "app-db",
      "psql",
      "-U",
      "app",
      "-d",
      "ai_assistant",
      "-Atc",
      statement,
    ],
    { cwd: root, encoding: "utf8" },
  );

let failures = 0;
const check = (name, condition, detail = "") => {
  console.log(`${condition ? "  ok " : "  FALLA"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!condition) failures += 1;
};

const courseId = Number(
  php("echo $DB->get_field('course', 'id', ['shortname' => 'AN-401-PRUEBA']);"),
);
const teacherId = Number(
  php("echo $DB->get_field('user', 'id', ['username' => 'prueba_docente']);"),
);
if (!courseId || !teacherId) {
  console.error("Falta el curso AN-401-PRUEBA. Ejecuta seed_curso_prueba.php primero.");
  process.exit(2);
}

function token(forUser = teacherId, forCourse = courseId) {
  const now = Math.floor(Date.now() / 1000);
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${enc({ typ: "JWT", alg: "HS256" })}.${enc({ iss: MOODLE_URL, aud: "smart-lms-api", sub: String(forUser), courseid: forCourse, iat: now, exp: now + 300, jti: randomBytes(16).toString("hex") })}`;
  return `${unsigned}.${createHmac("sha256", env.PLUGIN_JWT_SECRET).update(unsigned).digest("base64url")}`;
}
async function call(method, path, body, as = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token(as.user, as.course)}`,
      ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function upload(filename, bytes, type, as = {}) {
  const form = new FormData();
  form.set("courseId", String(as.course ?? courseId));
  form.set("file", new Blob([bytes], { type }), filename);
  return call("POST", "/syllabi", form, as);
}
async function waitFor(id, done, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { body } = await call("GET", `/syllabi/${id}`);
    if (done.includes(body.status)) return body;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return { status: "TIMEOUT" };
}

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
/** Analiza un archivo con el demonio de ClamAV (comando INSTREAM) y devuelve su veredicto. */
function scanWithClamav(bytes) {
  const url = new URL(
    env.CLAMAV_URL?.replace("${CLAMAV_PORT}", env.CLAMAV_PORT ?? "3310") ?? "tcp://localhost:3310",
  );
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(url.port || 3310), url.hostname);
    const chunks = [];
    socket.on("data", (data) => chunks.push(data));
    socket.on("error", reject);
    socket.on("close", () => resolve(Buffer.concat(chunks).toString().replace(/\0/g, "").trim()));
    const size = Buffer.alloc(4);
    size.writeUInt32BE(bytes.length);
    socket.write(Buffer.concat([Buffer.from("zINSTREAM\0"), size, bytes, Buffer.alloc(4)]));
  });
}

const manifest = JSON.parse(readFileSync(join(FIXTURES, "manifest.json"), "utf8"));
const created = [];
const mime = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

try {
  console.log("1. Los sílabos sintéticos, de la carga a la extracción");
  for (const spec of manifest.syllabi) {
    const bytes = readFileSync(join(FIXTURES, spec.file));
    const ext = spec.file.endsWith(".docx") ? "docx" : "pdf";
    const sent = await upload(spec.file, bytes, mime[ext]);
    if (sent.status !== 202) {
      check(
        `${spec.slug}: la carga se acepta`,
        false,
        `HTTP ${sent.status} ${sent.body.code ?? ""}`,
      );
      continue;
    }
    created.push(sent.body.id);
    const text = await waitFor(sent.body.id, ["TEXT_READY", "FAILED"]);
    const expectedConfidence = spec.format === "scan" ? "low" : "high";
    check(
      `${spec.slug} (${spec.format}): el worker extrae el texto`,
      text.status === "TEXT_READY" && (spec.format === "docx" || text.pageCount > 0),
      `${text.status}, ${text.pageCount ?? "?"} páginas${text.errorCode ? `, ${text.errorCode}` : ""}`,
    );
    if (text.status !== "TEXT_READY") continue;
    check(
      `${spec.slug}: la confianza del texto es ${expectedConfidence}`,
      text.textConfidence === expectedConfidence ||
        (spec.format === "docx" && text.textConfidence === "low"),
      `textConfidence = ${text.textConfidence}`,
    );
    const asked = await call("POST", `/syllabi/${sent.body.id}/extract`);
    const extracted =
      asked.status === 202
        ? await waitFor(sent.body.id, ["EXTRACTED", "FAILED"])
        : { status: `HTTP ${asked.status}` };
    check(
      `${spec.slug}: la extracción termina`,
      extracted.status === "EXTRACTED",
      extracted.status,
    );
    if (extracted.status !== "EXTRACTED") continue;
    const version = await call("GET", `/syllabi/${sent.body.id}/extraction`);
    const parsed = syllabusExtractionSchema.safeParse(version.body.content);
    check(
      `${spec.slug}: la extracción cumple el esquema v1`,
      parsed.success && version.body.version === 1,
    );
  }

  console.log("\n2. Rechazos");
  const first = join(FIXTURES, manifest.syllabi[0].file);
  const sample = readFileSync(first);
  const duplicate = await upload("copia.pdf", sample, mime.pdf);
  check(
    "el mismo archivo no se carga dos veces (409 DUPLICATE_SYLLABUS)",
    duplicate.status === 409 && duplicate.body.code === "DUPLICATE_SYLLABUS",
    `HTTP ${duplicate.status}`,
  );

  const fake = await upload("silabo.pdf", Buffer.from("MZ este archivo no es un PDF"), mime.pdf);
  check(
    "una extensión que no corresponde al contenido se rechaza (415)",
    fake.status === 415,
    `HTTP ${fake.status} ${fake.body.code ?? ""}`,
  );
  const wrongExt = await upload("silabo.exe", sample, mime.pdf);
  check(
    "una extensión no permitida se rechaza (415 EXTENSION_NOT_ALLOWED)",
    wrongExt.status === 415 && wrongExt.body.code === "EXTENSION_NOT_ALLOWED",
    `HTTP ${wrongExt.status}`,
  );
  const empty = await upload("vacio.pdf", Buffer.alloc(0), mime.pdf);
  check("un archivo vacío se rechaza (400)", empty.status === 400, `HTTP ${empty.status}`);

  const macros = Buffer.from(buildDocx("", { "word/vbaProject.bin": "macro" }));
  const withMacros = await upload("macros.docx", macros, mime.docx);
  check(
    "un DOCX con macros se rechaza (415 MACROS_NOT_ALLOWED)",
    withMacros.status === 415 && withMacros.body.code === "MACROS_NOT_ALLOWED",
    `HTTP ${withMacros.status} ${withMacros.body.code ?? ""}`,
  );

  // El archivo de prueba EICAR no puede pasar la validación de tipo del API (no empieza con %PDF), así que se
  // comprueba el antivirus en sí: el demonio debe estar vivo y marcar EICAR como infectado.
  const verdict = await scanWithClamav(Buffer.from(EICAR));
  check("ClamAV marca el archivo de prueba EICAR como infectado", /FOUND$/.test(verdict), verdict);
  const clean = await scanWithClamav(sample);
  check("ClamAV deja pasar un sílabo limpio", /OK$/.test(clean), clean);

  const locked = Buffer.from(
    buildPdf([[{ text: "Silabo protegido", size: 12, y: 700 }]], { encrypted: true }),
  );
  const lockedSent = await upload("protegido.pdf", locked, mime.pdf);
  if (lockedSent.status === 202) created.push(lockedSent.body.id);
  const lockedState =
    lockedSent.status === 202
      ? await waitFor(lockedSent.body.id, ["TEXT_READY", "FAILED"])
      : { status: `HTTP ${lockedSent.status}` };
  check(
    "un PDF cifrado falla con ENCRYPTED_DOCUMENT",
    lockedState.status === "FAILED" && lockedState.errorCode === "ENCRYPTED_DOCUMENT",
    `${lockedState.status} ${lockedState.errorCode ?? ""}`,
  );
  console.log("\n3. Búsqueda en los documentos del curso (RAG)");
  const indexed = created[0];
  let chunkCount = 0;
  for (let i = 0; i < 20 && chunkCount === 0; i += 1) {
    chunkCount = Number(
      sql(`SELECT count(*) FROM document_chunks WHERE document_id = '${indexed}';`).trim(),
    );
    if (chunkCount === 0) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  check(
    "al quedar el texto listo, el documento se indexa solo",
    chunkCount > 0,
    `${chunkCount} fragmentos`,
  );
  const wrongCourse = Number(
    sql(
      `SELECT count(*) FROM document_chunks WHERE document_id = '${indexed}' AND moodle_course_id <> ${courseId};`,
    ).trim(),
  );
  check("todos los fragmentos llevan el curso del documento", wrongCourse === 0);
  const withPage = Number(
    sql(
      `SELECT count(*) FROM document_chunks WHERE document_id = '${indexed}' AND page IS NOT NULL;`,
    ).trim(),
  );
  check(
    "los fragmentos de un PDF llevan su página",
    withPage === chunkCount,
    `${withPage}/${chunkCount}`,
  );

  const ask = (message, as = {}) =>
    call("POST", "/assistant/chat", { courseId: as.course ?? courseId, message }, as);
  const biblio = await ask("¿Qué dice el sílabo sobre la bibliografía y los libros?");
  const found = biblio.body.data?.search_course_documents;
  check(
    "el chat busca en los documentos del curso",
    found?.found > 0,
    `${found?.found ?? 0} pasajes`,
  );
  check(
    "la respuesta cita el documento con su página",
    biblio.body.sources?.some(
      (source) => source.type === "document" && created.includes(source.id) && source.page > 0,
    ) && /página \d+/.test(biblio.body.answer ?? ""),
    JSON.stringify(biblio.body.sources?.slice(0, 2)),
  );
  const unit = await ask("¿Qué dice el documento sobre normalización y claves primarias?");
  check(
    "encuentra el pasaje que habla del tema (normalización)",
    JSON.stringify(unit.body.data?.search_course_documents?.passages ?? [])
      .toLowerCase()
      .includes("normaliz"),
  );
  const nothing = await ask("¿Qué dice el documento sobre helicópteros y paracaídas?");
  check(
    "si no hay nada parecido, lo dice y no cita fuentes",
    nothing.body.data?.search_course_documents?.found === 0 &&
      (nothing.body.sources ?? []).every((source) => source.type !== "document") &&
      /No encontr/.test(nothing.body.answer ?? ""),
    nothing.body.answer?.slice(0, 90),
  );

  // Aislamiento entre cursos: un sílabo de otro curso no aparece en las búsquedas de este.
  const otherCourse = Number(
    php("echo $DB->get_field('course', 'id', ['shortname' => 'IS-501-DEMO']);"),
  );
  const otherTeacher = Number(
    php("echo $DB->get_field('user', 'id', ['username' => 'docente1']);"),
  );
  const redes = manifest.syllabi.find((spec) => spec.slug.includes("redes"));
  const sent = await upload(redes.file, readFileSync(join(FIXTURES, redes.file)), mime.pdf, {
    user: otherTeacher,
    course: otherCourse,
  });
  if (sent.status === 202) {
    created.push(sent.body.id);
    await waitFor(sent.body.id, ["TEXT_READY", "FAILED"]);
    const own = await ask("¿Qué dice el documento sobre enrutamiento, VLAN y direcciones IPv4?", {
      user: otherTeacher,
      course: otherCourse,
    });
    check(
      "el otro curso encuentra su propio documento",
      own.body.data?.search_course_documents?.found > 0 &&
        own.body.sources?.some((source) => source.id === sent.body.id),
      `${own.body.data?.search_course_documents?.found ?? 0} pasajes de su propio documento`,
    );
    const leak = await ask("¿Qué dice el documento sobre enrutamiento, VLAN y direcciones IPv4?");
    check(
      "este curso NO ve los pasajes del documento del otro curso (SEC-01)",
      // Este curso también tiene su copia del mismo sílabo: lo que no puede aparecer es el documento del otro curso.
      (leak.body.sources ?? []).length > 0 &&
        !(leak.body.sources ?? []).some((source) => source.id === sent.body.id),
      `${(leak.body.sources ?? []).length} fuentes, todas de este curso`,
    );
  } else {
    check("se pudo cargar el sílabo del otro curso", false, `HTTP ${sent.status}`);
  }
} finally {
  console.log("\n4. Limpieza");
  if (created.length > 0) {
    const ids = created.map((id) => `'${id}'`).join(",");
    const keys = sql(
      `SELECT storage_key FROM syllabus_documents WHERE id IN (${ids}) AND storage_key IS NOT NULL;`,
    )
      .split("\n")
      .filter(Boolean);
    sql(`
      DELETE FROM syllabus_extractions WHERE document_id IN (${ids});
      DELETE FROM syllabus_documents WHERE id IN (${ids});`);
    for (const key of keys) {
      try {
        execFileSync("rm", [
          "-f",
          join(root, "apps", "api", env.STORAGE_DIR ?? "var/storage", key),
        ]);
      } catch {
        // Si el archivo ya no está, no hay nada que borrar.
      }
    }
    const left = Number(
      sql(`SELECT count(*) FROM document_chunks WHERE document_id IN (${ids});`).trim(),
    );
    check(
      "al borrar los sílabos se borran sus fragmentos",
      left === 0,
      `${left} fragmentos quedan`,
    );
    console.log(`  ${created.length} sílabos borrados de la base y del almacén`);
  }
}

console.log(
  failures === 0
    ? "\nTODO BIEN: la carga y la extracción de sílabos funcionan de punta a punta."
    : `\nHAY ${failures} COMPROBACIONES QUE FALLAN.`,
);
process.exit(failures === 0 ? 0 : 1);
