// Verificación de punta a punta de CU-02 y CU-03 con el backend, PostgreSQL, Redis y Moodle reales.
//
//   node infra/scripts/smoke-publicacion.mjs
//
// Requisitos (entorno local, ver docs/desarrollo/entorno-local.md):
//   - `docker compose up -d` (base auxiliar y Redis) y el backend corriendo (`pnpm --filter @smart-lms/api dev`).
//   - Moodle levantado con los datos sintéticos (`moodle.sh up`, `install`, `seed`) y el plugin al día.
//   - `pnpm --filter @smart-lms/contracts build` (usa la extracción de ejemplo).
//
// Qué hace: siembra un sílabo ya revisado en el curso IS-501-DEMO, genera la propuesta, la aprueba, la publica,
// comprueba lo creado en Moodle (secciones, tareas, ocultas, fecha de entrega), repite la publicación y
// intenta publicar con otra clave. Al final borra todo lo que creó, también en Moodle.
// Termina con código 0 si todas las comprobaciones pasan.
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
const BASE = `http://localhost:${env.PORT ?? 3000}/api/v1`;
const MOODLE_URL = "http://localhost:8000";
const { buildSyllabusExtraction } = await import(
  pathToFileURL(join(root, "packages", "contracts", "dist", "index.js")).href
);

const run = (file, args, input) =>
  execFileSync(file, args, {
    cwd: root,
    input,
    encoding: "utf8",
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
/** Ejecuta código PHP dentro del contenedor de Moodle y devuelve su salida sin el aviso de moodle-docker. */
const php = (code) =>
  run(
    "bash",
    ["infra/scripts/moodle.sh", "compose", "exec", "-T", "webserver", "php"],
    `<?php define('CLI_SCRIPT', true); require '/var/www/html/config.php'; require_once $CFG->dirroot.'/course/lib.php'; \\core\\session\\manager::set_user(get_admin()); ${code}`,
  )
    .split("\n")
    .filter((line) => !line.startsWith("Including local options"))
    .join("\n")
    .trim();
const sql = (statement) =>
  run("docker", [
    "compose",
    "exec",
    "-T",
    "app-db",
    "psql",
    "-U",
    "app",
    "-d",
    "ai_assistant",
    "-v",
    "ON_ERROR_STOP=1",
    "-Atc",
    statement,
  ]);

let failures = 0;
const check = (name, condition, detail = "") => {
  console.log(`${condition ? "  ok " : "  FALLA"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!condition) failures += 1;
};

const courseId = Number(
  php("echo $DB->get_field('course', 'id', ['shortname' => 'IS-501-DEMO']);"),
);
const teacherId = Number(php("echo $DB->get_field('user', 'id', ['username' => 'docente1']);"));
console.log(`Curso IS-501-DEMO = ${courseId}, docente1 = ${teacherId}`);

function token() {
  const now = Math.floor(Date.now() / 1000);
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${enc({ typ: "JWT", alg: "HS256" })}.${enc({ iss: MOODLE_URL, aud: "smart-lms-api", sub: String(teacherId), courseid: courseId, iat: now, exp: now + 300, jti: randomBytes(16).toString("hex") })}`;
  return `${unsigned}.${createHmac("sha256", env.PLUGIN_JWT_SECRET).update(unsigned).digest("base64url")}`;
}
async function call(method, path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const documentId = randomUUID();
let proposalId;
try {
  console.log("\n1. Siembra de un sílabo revisado");
  const content = JSON.stringify(buildSyllabusExtraction()).replaceAll("'", "''");
  sql(`
    INSERT INTO integration_accounts (id, name, moodle_base_url, token_secret_ref, jwt_key_ref, status)
      VALUES ('${randomUUID()}', 'smoke', '${MOODLE_URL}', 'x', 'x', 'ACTIVE') ON CONFLICT (moodle_base_url) DO NOTHING;
    INSERT INTO syllabus_documents (id, integration_account_id, moodle_course_id, uploaded_by, filename, mime_type, size_bytes, checksum_sha256, status, retain_until, updated_at)
      SELECT '${documentId}', id, ${courseId}, ${teacherId}, 'smoke.pdf', 'application/pdf', 10, '${randomBytes(32).toString("hex")}', 'REVIEWED', now() + interval '1 day', now()
      FROM integration_accounts WHERE moodle_base_url = '${MOODLE_URL}';
    INSERT INTO syllabus_extractions (id, document_id, version, schema_version, content, consistency_issues, source)
      VALUES ('${randomUUID()}', '${documentId}', 1, '1.0', '${content}'::jsonb, '[]'::jsonb, 'TEACHER');`);
  check("sílabo sembrado", true);

  console.log("\n2. Propuesta y aprobación (CU-02)");
  const created = await call("POST", "/proposals", {
    syllabusId: documentId,
    extractionVersion: 1,
  });
  proposalId = created.body.id;
  check(
    "la propuesta se genera en NEEDS_REVIEW",
    created.status === 201 && created.body.status === "NEEDS_REVIEW",
    `HTTP ${created.status}`,
  );
  check("tiene 2 secciones y 2 actividades", created.body.items?.length === 4);
  const approved = await call("POST", `/proposals/${proposalId}/approve`);
  check(
    "se aprueba con aprobador",
    approved.status === 200 &&
      approved.body.status === "APPROVED" &&
      approved.body.approvedBy === teacherId,
  );

  console.log("\n3. Publicación (CU-03)");
  const key = `humo-${randomBytes(8).toString("hex")}`;
  const sinConfirmar = await call(
    "POST",
    `/proposals/${proposalId}/publish`,
    {},
    { "Idempotency-Key": key },
  );
  check("sin confirmación explícita no publica", sinConfirmar.status === 400);
  const started = await call(
    "POST",
    `/proposals/${proposalId}/publish`,
    { confirm: true },
    { "Idempotency-Key": key },
  );
  check("la publicación se acepta (202)", started.status === 202);
  let operation = started.body;
  for (let i = 0; i < 60 && operation.status === "RUNNING"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    operation = (
      await call("GET", `/proposals/${proposalId}/publish-operations/${started.body.id}`)
    ).body;
  }
  check(
    "termina SUCCEEDED con 4 elementos",
    operation.status === "SUCCEEDED" && operation.createdCount === 4,
    `${operation.status}, ${operation.createdCount} creados`,
  );

  console.log("\n4. Lo que quedó en Moodle");
  const final = (await call("GET", `/proposals/${proposalId}`)).body;
  const ids = final.items.map((item) => item.id);
  const inMoodle = JSON.parse(
    php(`
      $ids = ${JSON.stringify(ids)};
      $out = ['modules' => [], 'sections' => 0];
      foreach ($ids as $id) {
        $cm = $DB->get_record_sql("SELECT cm.id, cm.visible, a.name, a.duedate FROM {course_modules} cm JOIN {assign} a ON a.id = cm.instance WHERE cm.course = ? AND cm.idnumber = ?", [${courseId}, 'ai:' . $id]);
        if ($cm) { $out['modules'][] = ['name' => $cm->name, 'visible' => (int) $cm->visible, 'hasdue' => (int) $cm->duedate > 0]; }
      }
      $out['sections'] = $DB->count_records_select('local_ai_assistant_items', "courseid = ? AND itemtype = 'section' AND itemuuid IN ('" . implode("','", $ids) . "')", [${courseId}]);
      echo json_encode($out);`),
  );
  check("2 secciones creadas", inMoodle.sections === 2);
  check(
    "2 tareas creadas, ocultas",
    inMoodle.modules.length === 2 && inMoodle.modules.every((m) => m.visible === 0),
  );
  check(
    "solo la tarea con fecha en la extracción tiene fecha de entrega",
    inMoodle.modules.filter((m) => m.hasdue).length === 1,
  );
  check(
    "cada elemento guardó su id de Moodle",
    final.status === "PUBLISHED" &&
      final.items.every((item) => item.publishStatus === "CREATED" && item.moodleItemId),
  );

  console.log("\n5. Repetición sin duplicados (SEC-04)");
  const again = await call(
    "POST",
    `/proposals/${proposalId}/publish`,
    { confirm: true },
    { "Idempotency-Key": key },
  );
  check(
    "la misma clave devuelve la misma operación",
    again.status === 202 && again.body.id === started.body.id,
  );
  const other = await call(
    "POST",
    `/proposals/${proposalId}/publish`,
    { confirm: true },
    { "Idempotency-Key": `otra-${randomBytes(8).toString("hex")}` },
  );
  check(
    "otra clave sobre una propuesta publicada responde 409",
    other.status === 409 && other.body.code === "INVALID_TRANSITION",
  );
  const total = Number(
    php(`
      $n = 0;
      foreach (${JSON.stringify(ids)} as $id) {
        if ($DB->record_exists('course_modules', ['course' => ${courseId}, 'idnumber' => 'ai:' . $id])) { $n++; }
      }
      echo $n;`),
  );
  check("Moodle sigue con 2 actividades de esta propuesta", total === 2, `${total}`);
} catch (error) {
  failures += 1;
  console.error(`\nERROR inesperado: ${error.message}`);
} finally {
  console.log("\n6. Limpieza");
  try {
    php(`
      $ids = array_map(fn($m) => $m, $DB->get_fieldset_select('local_ai_assistant_items', 'itemuuid', 'courseid = ?', [${courseId}]));
      foreach ($ids as $uuid) {
        $cmid = $DB->get_field('course_modules', 'id', ['course' => ${courseId}, 'idnumber' => 'ai:' . $uuid]);
        if ($cmid) { course_delete_module($cmid); }
      }
      $course = get_course(${courseId});
      foreach ($DB->get_records('local_ai_assistant_items', ['courseid' => ${courseId}, 'itemtype' => 'section']) as $row) {
        $section = $DB->get_record('course_sections', ['id' => $row->moodleid]);
        if ($section) { course_delete_section($course, $section, true); }
      }
      $DB->delete_records('local_ai_assistant_items', ['courseid' => ${courseId}]);
      rebuild_course_cache(${courseId}, true);`);
    sql(`
      DELETE FROM activity_unit_mappings WHERE moodle_course_id = ${courseId};
      DELETE FROM publish_operations WHERE proposal_id IN (SELECT id FROM course_proposals WHERE moodle_course_id = ${courseId});
      DELETE FROM course_proposals WHERE moodle_course_id = ${courseId};
      DELETE FROM syllabus_documents WHERE id = '${documentId}';
      DELETE FROM audit_events WHERE moodle_course_id = ${courseId};`);
    console.log("  datos de la prueba borrados");
  } catch (error) {
    console.error(`  no se pudo limpiar del todo: ${error.message}`);
    failures += 1;
  }
}

console.log(
  failures === 0
    ? "\nTODO BIEN: CU-02 y CU-03 funcionan de punta a punta."
    : `\n${failures} comprobación(es) fallaron.`,
);
process.exit(failures === 0 ? 0 : 1);
