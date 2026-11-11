// Prueba de carga básica (Sprint 12, RNF-01 a RNF-03). Sin dependencias: Node 24.
//
//   node infra/loadtest/load.mjs --scenario session --concurrency 20 --duration 15
//
// Escenarios:
//   session   GET /session: pasa por el token de un solo uso, el límite de peticiones y la verificación de
//             permisos en Moodle (con caché de 120 s). Mide lo que cuesta cada petición autenticada.
//   chat      POST /assistant/chat con Accept: text/event-stream. Mide el tiempo hasta el primer evento
//             (RNF-01, meta p95 < 3 s) y hasta el evento final (RNF-02, meta p95 < 10 s). Con la API
//             simulada (`pnpm mock:ai`) los números solo prueban el script; son válidos con el proveedor real.
//
// Opciones (o variables de entorno):
//   --base         URL base del API (por defecto http://localhost:3000/api/v1)
//   --env          .env del que leer PLUGIN_JWT_SECRET y MOODLE_BASE_URL (por defecto ./.env)
//   --user         id de Moodle del docente (por defecto 4)
//   --course       id del curso del token (por defecto 2)
//   --concurrency  peticiones simultáneas (por defecto 10)
//   --duration     segundos de prueba (por defecto 10)
//
// Para medir el backend sin que el límite por usuario responda 429, arráncalo con RATE_LIMIT_PER_MINUTE=0.
// Termina con código 1 si hubo errores o si no se cumple la meta del escenario.
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    scenario: { type: "string", default: "session" },
    base: { type: "string", default: process.env.LOAD_BASE ?? "http://localhost:3000/api/v1" },
    env: { type: "string", default: ".env" },
    user: { type: "string", default: "4" },
    course: { type: "string", default: "2" },
    concurrency: { type: "string", default: "10" },
    duration: { type: "string", default: "10" },
  },
});

const env = Object.fromEntries(
  readFileSync(values.env, "utf8")
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
if (!env.PLUGIN_JWT_SECRET) throw new Error(`Falta PLUGIN_JWT_SECRET en ${values.env}`);

/** Un token distinto por petición: el `jti` es de un solo uso. */
function token() {
  const now = Math.floor(Date.now() / 1000);
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const unsigned = `${enc({ typ: "JWT", alg: "HS256" })}.${enc({
    iss: env.MOODLE_BASE_URL ?? "http://localhost:8000",
    aud: "smart-lms-api",
    sub: values.user,
    courseid: Number(values.course),
    iat: now,
    exp: now + 300,
    jti: randomBytes(16).toString("hex"),
  })}`;
  return `${unsigned}.${createHmac("sha256", env.PLUGIN_JWT_SECRET).update(unsigned).digest("base64url")}`;
}

const headers = () => ({ Authorization: `Bearer ${token()}`, "Content-Type": "application/json" });

/** Cada escenario devuelve las mediciones de una petición, en milisegundos, y el código HTTP. */
const scenarios = {
  async session() {
    const start = performance.now();
    const res = await fetch(`${values.base}/session`, { headers: headers() });
    await res.arrayBuffer();
    return { status: res.status, total: performance.now() - start };
  },
  async chat() {
    const start = performance.now();
    const res = await fetch(`${values.base}/assistant/chat`, {
      method: "POST",
      headers: { ...headers(), Accept: "text/event-stream" },
      body: JSON.stringify({
        courseId: Number(values.course),
        conversationId: null,
        message: "¿Qué estudiantes no entregaron la tarea 3?",
      }),
    });
    if (!res.ok || !res.body) return { status: res.status, total: performance.now() - start };
    const reader = res.body.getReader();
    let firstEvent = null;
    for (;;) {
      const { done } = await reader.read();
      firstEvent ??= performance.now() - start;
      if (done) break;
    }
    return { status: res.status, first: firstEvent, total: performance.now() - start };
  },
};

const targets = {
  session: { metric: "total", p95: 1000, label: "p95 < 1 s por petición autenticada" },
  chat: { metric: "first", p95: 3000, label: "RNF-01: primer token p95 < 3 s" },
};

const percentile = (sorted, p) =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
    : NaN;
const fmt = (ms) => (Number.isNaN(ms) ? "—" : `${ms.toFixed(0)} ms`);

async function main() {
  const run = scenarios[values.scenario];
  if (!run)
    throw new Error(
      `Escenario desconocido: ${values.scenario} (${Object.keys(scenarios).join(", ")})`,
    );
  const concurrency = Number(values.concurrency);
  const deadline = Date.now() + Number(values.duration) * 1000;
  const samples = [];
  const errors = new Map();
  const started = performance.now();

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (Date.now() < deadline) {
        try {
          const sample = await run();
          samples.push(sample);
          if (sample.status >= 400)
            errors.set(`HTTP ${sample.status}`, (errors.get(`HTTP ${sample.status}`) ?? 0) + 1);
        } catch (error) {
          errors.set(
            String(error.cause?.code ?? error.message),
            (errors.get(String(error.cause?.code ?? error.message)) ?? 0) + 1,
          );
        }
      }
    }),
  );

  const seconds = (performance.now() - started) / 1000;
  const ok = samples.filter((s) => s.status < 400);
  const totals = ok.map((s) => s.total).sort((a, b) => a - b);
  const firsts = ok
    .map((s) => s.first)
    .filter((v) => v !== undefined)
    .sort((a, b) => a - b);
  const failed =
    samples.length -
    ok.length +
    [...errors.entries()].filter(([k]) => !k.startsWith("HTTP")).reduce((n, [, c]) => n + c, 0);

  console.log(
    `Escenario ${values.scenario}: ${concurrency} simultáneas durante ${seconds.toFixed(1)} s contra ${values.base}`,
  );
  console.log(
    `Peticiones: ${samples.length} (${(samples.length / seconds).toFixed(1)}/s), con error: ${failed}`,
  );
  console.log(
    `Tiempo total   p50 ${fmt(percentile(totals, 50))}   p95 ${fmt(percentile(totals, 95))}   p99 ${fmt(percentile(totals, 99))}   máx ${fmt(totals.at(-1) ?? NaN)}`,
  );
  if (firsts.length)
    console.log(
      `Primer evento  p50 ${fmt(percentile(firsts, 50))}   p95 ${fmt(percentile(firsts, 95))}   p99 ${fmt(percentile(firsts, 99))}`,
    );
  if (errors.size)
    console.log(`Errores: ${[...errors.entries()].map(([k, c]) => `${k} ×${c}`).join(", ")}`);

  const target = targets[values.scenario];
  const measured = percentile(target.metric === "first" ? firsts : totals, 95);
  const met = measured <= target.p95;
  console.log(`Meta (${target.label}): ${met ? "CUMPLIDA" : "NO CUMPLIDA"} (${fmt(measured)})`);
  process.exit(failed > 0 || !met ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
