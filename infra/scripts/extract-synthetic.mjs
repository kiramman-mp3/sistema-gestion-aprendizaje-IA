// Pasa los sílabos sintéticos por la extracción real (carga, antivirus, worker, proveedor de IA) y guarda lo que devolvió
// el sistema como `<nombre>.actual.json`, junto a la extracción esperada, para medir el F1 con `evaluate-extraction.mjs`.
//
//   node infra/scripts/extract-synthetic.mjs [directorio de salida] [--only 01,05]
//
// Requisitos: los de `smoke-silabos.mjs` (ClamAV, worker, Moodle con AN-401-PRUEBA) y el backend con un proveedor de IA
// real (`AI_PROVIDER=gemini`, `AI_API_KEY` en el `.env`). Con el proveedor de demostración todas las extracciones serían
// el sílabo de ejemplo y el resultado no significaría nada.
//
// Escribe en el directorio de salida (por defecto `var/extraction-eval`, fuera de git) los `.expected.json`, los
// `.actual.json` y `tiempos.json`. Los sílabos que ya se cargaron se borran al terminar. Respeta los límites del proveedor:
// espera `PAUSE_MS` (por defecto 8000) entre sílabos y reintenta una vez si el proveedor responde que no está disponible.
//
// IMPORTANTE: los sílabos son sintéticos. El resultado valida el flujo y da una primera idea, pero NO es el F1 de la tesis.
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const out = resolve(
  args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--only") ??
    join(root, "var", "extraction-eval"),
);
const PAUSE_MS = Number(process.env.PAUSE_MS ?? 8000);
const env = Object.fromEntries(
  readFileSync(join(root, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const BASE = `http://localhost:${env.PORT ?? 3000}/api/v1`;
const FIXTURES = join(root, "tests", "fixtures", "synthetic-syllabi");

const php = (code) =>
  execFileSync("bash", ["infra/scripts/moodle.sh", "compose", "exec", "-T", "webserver", "php"], {
    cwd: root,
    input: `<?php define('CLI_SCRIPT', true); require '/var/www/html/config.php'; ${code}`,
    encoding: "utf8",
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
  })
    .split("\n")
    .filter((l) => !l.startsWith("Including local options"))
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
    {
      cwd: root,
      encoding: "utf8",
    },
  );

const courseId = Number(
  php("echo $DB->get_field('course', 'id', ['shortname' => 'AN-401-PRUEBA']);"),
);
const teacherId = Number(
  php("echo $DB->get_field('user', 'id', ['username' => 'prueba_docente']);"),
);
const token = () => {
  const now = Math.floor(Date.now() / 1000);
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const u = `${enc({ typ: "JWT", alg: "HS256" })}.${enc({ iss: "http://localhost:8000", aud: "smart-lms-api", sub: String(teacherId), courseid: courseId, iat: now, exp: now + 300, jti: randomBytes(16).toString("hex") })}`;
  return `${u}.${createHmac("sha256", env.PLUGIN_JWT_SECRET).update(u).digest("base64url")}`;
};
async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(id, done, timeoutMs = 240_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { body } = await call("GET", `/syllabi/${id}`);
    if (done.includes(body.status)) return body;
    await wait(1500);
  }
  return { status: "TIMEOUT" };
}

const manifest = JSON.parse(readFileSync(join(FIXTURES, "manifest.json"), "utf8"));
mkdirSync(out, { recursive: true });
const mime = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const created = [];
const timings = {};
const failures = [];

try {
  for (const spec of manifest.syllabi) {
    if (only && !only.some((n) => spec.slug.startsWith(n))) continue;
    copyFileSync(
      join(FIXTURES, `${spec.slug}.expected.json`),
      join(out, `${spec.slug}.expected.json`),
    );
    const ext = spec.file.endsWith(".docx") ? "docx" : "pdf";
    const form = new FormData();
    form.set("courseId", String(courseId));
    form.set(
      "file",
      new Blob([readFileSync(join(FIXTURES, spec.file))], { type: mime[ext] }),
      spec.file,
    );
    const sent = await call("POST", "/syllabi", form);
    if (sent.status !== 202) {
      failures.push(`${spec.slug}: carga HTTP ${sent.status} ${sent.body.code ?? ""}`);
      continue;
    }
    created.push(sent.body.id);
    const text = await waitFor(sent.body.id, ["TEXT_READY", "FAILED"]);
    if (text.status !== "TEXT_READY") {
      failures.push(`${spec.slug}: texto ${text.status} ${text.errorCode ?? ""}`);
      continue;
    }
    let extracted = { status: "?" };
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const started = Date.now();
      const asked = await call("POST", `/syllabi/${sent.body.id}/extract`);
      extracted =
        asked.status === 202
          ? await waitFor(sent.body.id, ["EXTRACTED", "FAILED"])
          : { status: `HTTP ${asked.status}` };
      timings[spec.slug] = { ms: Date.now() - started, attempts: attempt };
      if (extracted.status === "EXTRACTED") break;
      await wait(20_000);
    }
    if (extracted.status !== "EXTRACTED") {
      failures.push(`${spec.slug}: extracción ${extracted.status} ${extracted.errorCode ?? ""}`);
      continue;
    }
    const version = await call("GET", `/syllabi/${sent.body.id}/extraction`);
    writeFileSync(
      join(out, `${spec.slug}.actual.json`),
      `${JSON.stringify(version.body.content, null, 2)}\n`,
    );
    console.log(
      `  ok  ${spec.slug}: ${timings[spec.slug].ms} ms${text.textConfidence === "low" ? " (texto de OCR)" : ""}`,
    );
    await wait(PAUSE_MS);
  }
} finally {
  if (created.length > 0) {
    const ids = created.map((id) => `'${id}'`).join(",");
    const keys = sql(
      `SELECT storage_key FROM syllabus_documents WHERE id IN (${ids}) AND storage_key IS NOT NULL;`,
    )
      .split("\n")
      .filter(Boolean);
    sql(
      `DELETE FROM syllabus_extractions WHERE document_id IN (${ids}); DELETE FROM syllabus_documents WHERE id IN (${ids});`,
    );
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
  }
}
writeFileSync(join(out, "tiempos.json"), `${JSON.stringify(timings, null, 2)}\n`);
for (const failure of failures) console.log(`  FALLA ${failure}`);
console.log(
  `\nResultados en ${out}. Mide el F1 con: node infra/scripts/evaluate-extraction.mjs "${out}"`,
);
process.exit(failures.length === 0 ? 0 : 1);
