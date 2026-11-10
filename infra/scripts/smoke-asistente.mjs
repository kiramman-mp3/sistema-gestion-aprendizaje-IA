// Verificación de punta a punta del chat y la analítica (CU-04 a CU-06) con el backend, Redis y Moodle reales.
//
//   node infra/scripts/smoke-asistente.mjs
//
// Requisitos (entorno local, ver docs/desarrollo/entorno-local.md):
//   - `docker compose up -d` y el backend corriendo con el proveedor de demostración:
//     `AI_PROVIDER=mock pnpm --filter @smart-lms/api dev`.
//   - Moodle levantado con el plugin al día, `setup_integration.php` ejecutado y el curso de prueba creado:
//     `bash infra/scripts/moodle.sh compose exec -T webserver php /opt/smart-lms/cli/seed_curso_prueba.php`.
//
// Qué hace: con el docente `prueba_docente` y el curso AN-401-PRUEBA, hace una pregunta al chat (SSE), comprueba que
// la respuesta usa seudónimos con `data.students` y que ningún nombre sale de Moodle, pide la analítica y las
// evidencias de un estudiante, y comprueba que un docente sin acceso al curso es rechazado.
// No escribe nada en Moodle ni en la base del backend, salvo la conversación del chat y la auditoría.
// Termina con código 0 si todas las comprobaciones pasan.
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
const BASE = `http://localhost:${env.PORT ?? 3000}/api/v1`;
const MOODLE_URL = "http://localhost:8000";

/** Ejecuta código PHP dentro del contenedor de Moodle y devuelve su salida sin el aviso de moodle-docker. */
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

let failures = 0;
const check = (name, condition, detail = "") => {
  console.log(`${condition ? "  ok " : "  FALLA"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!condition) failures += 1;
};

const userId = (username) =>
  Number(php(`echo $DB->get_field('user', 'id', ['username' => '${username}']);`));
const courseId = Number(
  php("echo $DB->get_field('course', 'id', ['shortname' => 'AN-401-PRUEBA']);"),
);
if (!courseId) {
  console.error("No existe el curso AN-401-PRUEBA. Ejecuta seed_curso_prueba.php primero.");
  process.exit(2);
}
const teacherId = userId("prueba_docente");
const outsiderId = userId("prueba_ajeno");
const studentIds = new Set(
  JSON.parse(
    php(
      `echo json_encode(array_map('intval', array_column($DB->get_records_sql("SELECT u.id FROM {user} u WHERE u.username LIKE 'prueba_est%'"), 'id')));`,
    ),
  ),
);
const studentNames = JSON.parse(
  php(
    `echo json_encode(array_map(fn($u) => $u->firstname . ' ' . $u->lastname, array_values($DB->get_records_sql("SELECT u.id, u.firstname, u.lastname FROM {user} u WHERE u.username LIKE 'prueba_est%'"))));`,
  ),
);
console.log(`Curso AN-401-PRUEBA = ${courseId}, prueba_docente = ${teacherId}`);

function token(sub) {
  const now = Math.floor(Date.now() / 1000);
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${enc({ typ: "JWT", alg: "HS256" })}.${enc({ iss: MOODLE_URL, aud: "smart-lms-api", sub: String(sub), courseid: courseId, iat: now, exp: now + 300, jti: randomBytes(16).toString("hex") })}`;
  return `${unsigned}.${createHmac("sha256", env.PLUGIN_JWT_SECRET).update(unsigned).digest("base64url")}`;
}
async function call(method, path, body, { as = teacherId, accept = "application/json" } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token(as)}`,
      "Content-Type": "application/json",
      Accept: accept,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, headers: res.headers, text: await res.text() };
}
const json = (res) => {
  try {
    return JSON.parse(res.text);
  } catch {
    return {};
  }
};
const events = (text) =>
  text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => ({
      event: /^event: (.*)$/m.exec(block)?.[1],
      data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? "{}"),
    }));
const noNames = (value) => !studentNames.some((name) => JSON.stringify(value).includes(name));

console.log("\n1. Sesión y permisos del docente");
const session = await call("GET", "/session");
check("el docente entra al asistente (200)", session.status === 200, `HTTP ${session.status}`);
check(
  "ve los permisos de usar y ver analítica",
  session.status === 200 && JSON.stringify(json(session)).includes("viewanalytics"),
);

console.log("\n2. Chat con streaming (CU-04)");
const asked = await call(
  "POST",
  "/assistant/chat",
  { courseId, message: "¿Qué hay pendiente de calificar?" },
  { accept: "text/event-stream" },
);
check(
  "responde como flujo de eventos",
  asked.status === 200 && (asked.headers.get("content-type") ?? "").includes("text/event-stream"),
  `HTTP ${asked.status}`,
);
const stream = asked.status === 200 ? events(asked.text) : [];
const final = stream.find((e) => e.event === "final")?.data;
check("termina con un evento final", Boolean(final));
check(
  "el evento final trae la respuesta, las fuentes y la fecha",
  typeof final?.answer === "string" && Array.isArray(final?.sources) && Boolean(final?.generatedAt),
);
const students = final?.data?.students ?? [];
check(
  "data.students lista los seudónimos con ids de estudiantes del curso",
  students.length > 0 &&
    students.every((s) => /^Estudiante#\d{8}$/.test(s.alias) && studentIds.has(s.studentId)),
  `${students.length} estudiantes`,
);
check(
  "cada seudónimo de la respuesta está en data.students",
  [...(final?.answer ?? "").matchAll(/Estudiante#\d{8}/g)].every((m) =>
    students.some((s) => s.alias === m[0]),
  ),
);
check("ningún nombre de estudiante sale del backend", noNames(asked.text));
check(
  "los pendientes coinciden con Moodle (4: uno de la tarea 2 y tres de la tarea 3)",
  final?.data?.get_pending_grading?.totalPending === 4,
  `totalPending = ${final?.data?.get_pending_grading?.totalPending}`,
);
const grades = await call("POST", "/assistant/chat", { courseId, message: "¿Cómo van las notas?" });
const summary = json(grades).data?.get_grade_summary?.activities ?? [];
check(
  "las notas coinciden con Moodle y no incluyen la calificación oculta (11, 8 y 9)",
  summary.map((a) => a.graded).join(",") === "11,8,9",
  summary.map((a) => a.graded).join(",") || "sin datos",
);

console.log("\n3. Conversación y errores del chat");
const history = await call("GET", `/assistant/conversations/${final?.conversationId}`);
check("el historial devuelve la conversación (200)", history.status === 200);
check("el historial tampoco trae nombres", noNames(history.text));
const lost = await call("POST", "/assistant/chat", {
  courseId,
  conversationId: "99999999-9999-4999-8999-999999999999",
  message: "hola",
});
check(
  "una conversación inexistente responde 404 CONVERSATION_NOT_FOUND",
  lost.status === 404 && json(lost).code === "CONVERSATION_NOT_FOUND",
  `HTTP ${lost.status}`,
);
const invalid = await call("POST", "/assistant/chat", { courseId, message: "" });
check(
  "un mensaje vacío responde 400 con details",
  invalid.status === 400 && Array.isArray(json(invalid).details),
  `HTTP ${invalid.status}`,
);

console.log("\n4. Analítica y evidencias (CU-05)");
const analytics = await call("GET", `/analytics/courses/${courseId}`);
const dashboard = json(analytics);
check("el panel responde 200", analytics.status === 200, `HTTP ${analytics.status}`);
check(
  "trae indicadores con definición y señales con explicación",
  dashboard.indicators?.length > 0 &&
    dashboard.indicators.every((i) => Boolean(i.definition)) &&
    (dashboard.signals ?? []).every((s) => Boolean(s.explanation)),
  `${dashboard.indicators?.length ?? 0} indicadores, ${dashboard.signals?.length ?? 0} señales`,
);
check("no trae nombres de estudiantes", noNames(analytics.text));
const flagged = dashboard.signals?.[0]?.studentId;
if (flagged) {
  const evidence = await call("GET", `/analytics/courses/${courseId}/students/${flagged}`);
  const body = json(evidence);
  check(
    "las evidencias separan lo observado, lo calculado y lo que falta",
    evidence.status === 200 && "observed" in body && "computed" in body && "unknown" in body,
    `HTTP ${evidence.status}`,
  );
}

console.log("\n5. Aislamiento");
const outsider = await call("GET", `/analytics/courses/${courseId}`, undefined, {
  as: outsiderId,
});
check(
  "un docente sin acceso al curso no ve la analítica (403)",
  outsider.status === 403,
  `HTTP ${outsider.status}`,
);

console.log(
  failures === 0
    ? "\nTODO BIEN: el chat y la analítica funcionan de punta a punta."
    : `\nHAY ${failures} COMPROBACIONES QUE FALLAN.`,
);
process.exit(failures === 0 ? 0 : 1);
