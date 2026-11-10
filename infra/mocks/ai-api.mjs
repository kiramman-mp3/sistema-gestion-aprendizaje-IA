// API simulada de la parte de IA, para desarrollar y probar la interfaz del plugin sin el proveedor LLM.
//
// Implementa, con datos de ejemplo, lo que la línea de IA debe construir:
//   - POST /syllabi/:id/extract, GET y PUT /syllabi/:id/extraction  (Sprint 5)
//   - POST /assistant/chat (SSE o JSON) y GET /assistant/conversations/:id  (Sprints 8 y 9)
//   - GET /analytics/..., POST .../recommendations y .../followups  (Sprints 10 y 11)
//   - GET /audit y GET, PUT y DELETE /admin/difficulty-rules  (CU-06 y CU-07; el simulador da `admin` a todos)
// y responde /session y /health. No verifica el token (acepta cualquiera) y no guarda nada en disco.
//
// Uso:   pnpm mock:ai            (puerto 3100)   y apuntar el plugin a él:
//        bash infra/scripts/moodle.sh compose exec -T webserver php /var/www/html/admin/cli/cfg.php \
//          --component=local_ai_assistant --name=backendurl --set=http://localhost:3100/api/v1
// Las propuestas, la publicación y el mapeo de actividades NO están aquí: son del backend real.
//
// Convenciones para probar errores en el chat: un mensaje con «límite» responde 429 (con Retry-After); con
// «caído», 503; un `conversationId` que el simulador no conoce, 404 CONVERSATION_NOT_FOUND; un mensaje vacío, 400
// con `details`. La respuesta nombra a los estudiantes con seudónimos y trae `data.students`, como el backend real.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  buildSyllabusExtraction,
  findConsistencyIssues,
  syllabusExtractionSchema,
} from "@smart-lms/contracts";

/** Sílabo que existe desde el arranque; se abre con `index.php?courseid=…&syllabusid=<este id>`. */
export const MOCK_SYLLABUS_ID = "00000000-0000-4000-8000-0000000000a1";
const API = "/api/v1";

/** Parámetros por defecto de las reglas de dificultad, como los de `difficulty-rules.ts`. */
const RULES = {
  MISSING_REQUIRED: { minMissing: 2 },
  GRADE_BELOW_THRESHOLD: { thresholdPercent: 60, minActivities: 2 },
  SUSTAINED_DECLINE: { consecutive: 3 },
  REPEATED_OUTCOME_DIFFICULTY: { thresholdPercent: 60, minActivities: 2 },
};

/** Lee la identidad del token sin verificarlo: es un simulador. */
function identity(request) {
  const token = (request.headers.authorization ?? "").replace(/^Bearer /, "");
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString());
    return { userId: Number(payload.sub) || 0, courseId: Number(payload.courseid) || 0 };
  } catch {
    return { userId: 0, courseId: 0 };
  }
}

const json = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};
const error = (response, status, code, message = code, extra = {}) =>
  json(response, status, { code, message, ...extra });

/** Seudónimo de un estudiante, con el formato del backend real (`Estudiante#` y 8 dígitos). */
export const aliasOf = (studentId) => `Estudiante#${String(studentId).padStart(8, "0")}`;

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    return null;
  }
}

const sse = (response, event, data) =>
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Crea el servidor simulado.
 *
 * @param {{studentIds?: number[], delayMs?: number}} [options] `studentIds`: ids de Moodle de los estudiantes
 *     con señales; `delayMs`: pausa entre eventos del chat y de la extracción.
 */
export function createMockApi({ studentIds = [3, 5, 6], delayMs = 400 } = {}) {
  const syllabus = {
    id: MOCK_SYLLABUS_ID,
    status: "TEXT_READY",
    extractions: [],
    createdAt: new Date().toISOString(),
  };
  const conversations = new Map();
  // Reglas guardadas por alcance: "institution" o el id del curso.
  const savedRules = new Map();
  const auditEvents = Array.from({ length: 120 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    createdAt: new Date(Date.UTC(2026, 10, 10, 12, 0, 0) - i * 60_000).toISOString(),
    action: ["proposal.publish", "access.denied", "chat.query", "analytics.student"][i % 4],
    outcome: i % 4 === 1 ? "DENIED" : "SUCCESS",
    actorMoodleId: 4 + (i % 3),
    courseId: 7,
    resourceType: i % 4 === 0 ? "proposal" : null,
    resourceId: i % 4 === 0 ? `p${i}` : null,
    metadata: i % 4 === 2 ? { tools: 1 } : null,
  }));

  const syllabusDto = (courseId) => ({
    id: syllabus.id,
    courseId,
    filename: "silabo-ejemplo.pdf",
    status: syllabus.status,
    progress: syllabus.status === "PROCESSING" ? 50 : 100,
    pageCount: 4,
    textConfidence: "high",
    errorCode: null,
    latestExtractionVersion: syllabus.extractions.at(-1)?.version ?? null,
    createdAt: syllabus.createdAt,
  });

  const extractionDto = (extraction) => ({
    version: extraction.version,
    schemaVersion: "1.0",
    source: extraction.source,
    content: extraction.content,
    consistencyIssues: findConsistencyIssues(extraction.content),
    createdAt: extraction.createdAt,
  });

  const analytics = (courseId) => ({
    courseId,
    computedAt: new Date().toISOString(),
    indicators: [
      {
        key: "submission_rate",
        label: "Tasa de entrega a tiempo",
        value: 78.5,
        unit: "%",
        definition: "Entregas a tiempo sobre entregas esperadas en el periodo.",
      },
      {
        key: "pending_grading",
        label: "Pendientes de calificar",
        value: 14,
        unit: null,
        definition: "Entregas recibidas que aún no tienen calificación.",
      },
      {
        key: "average_grade",
        label: "Promedio del curso",
        value: 7.4,
        unit: "/10",
        definition: "Promedio de las calificaciones publicadas, normalizado a 10.",
      },
      {
        key: "participation",
        label: "Participación en foros",
        value: null,
        unit: "%",
        definition:
          "Estudiantes con al menos un mensaje en un foro. Sin foros calificados no hay dato.",
      },
    ],
    signals: studentIds.flatMap((studentId, i) => [
      {
        studentId,
        rule: "MISSING_REQUIRED",
        explanation: `No entregó ${2 + i} de 4 tareas obligatorias.`,
      },
      ...(i === 0
        ? [
            {
              studentId,
              rule: "SUSTAINED_DECLINE",
              explanation: "Sus notas bajaron en tres tareas seguidas (8, 6,5, 5).",
            },
          ]
        : []),
    ]),
  });

  const evidence = (courseId, studentId) => ({
    courseId,
    studentId,
    observed: [
      { label: "Tareas entregadas a tiempo", value: 1 },
      { label: "Tareas entregadas tarde", value: 1 },
      { tarea: "Tarea 3", estado: "sin entrega", vence: "2026-11-15" },
    ],
    computed: [
      {
        key: "on_time",
        label: "Entregas a tiempo",
        value: 33.3,
        unit: "%",
        definition: "Entregas a tiempo sobre entregas esperadas.",
      },
    ],
    unknown: ["No hay notas de la primera unidad.", "No se sabe si faltó a clase."],
  });

  const recommendation = () => ({
    id: randomUUID(),
    evidenceSummary: [
      "Una de tres tareas entregadas a tiempo.",
      "Las notas bajaron en las últimas tres entregas.",
    ],
    strengths: ["Entregó la primera tarea antes del plazo."],
    difficulties: ["Tareas pendientes acumuladas."],
    missingInformation: ["Notas de la primera unidad."],
    strategies: ["Una tutoría breve para ordenar los pendientes y acordar fechas."],
    reinforcementActivities: ["Ejercicio guiado de la unidad 1 antes de la Tarea 3."],
    followUpIndicators: ["Entregas a tiempo en las próximas dos semanas."],
  });

  async function chat(request, response, body) {
    const message = String(body.message ?? "");
    if (!message.trim())
      return error(
        response,
        400,
        "VALIDATION_ERROR",
        "La petición no cumple el formato esperado.",
        {
          details: [{ path: "message", message: "El mensaje no puede estar vacío." }],
        },
      );
    if (body.conversationId && !conversations.has(body.conversationId))
      return error(response, 404, "CONVERSATION_NOT_FOUND", "La conversación no existe.");
    if (/límite|limite/i.test(message)) {
      response.setHeader("Retry-After", "30");
      return error(response, 429, "RATE_LIMITED", "Límite de uso alcanzado.");
    }
    if (/caído|caido/i.test(message))
      return error(response, 503, "AI_PROVIDER_UNAVAILABLE", "Proveedor de IA no disponible.");

    const conversationId = body.conversationId ?? randomUUID();
    // Los ids de Moodle de quienes no entregaron; el texto lleva seudónimos y `data.students` dice a quién es cada uno.
    const students = studentIds
      .slice(0, 3)
      .map((studentId) => ({ alias: aliasOf(studentId), studentId }));
    const answer = `${students.length} estudiantes no entregaron la Tarea 3: ${students.map((s) => s.alias).join(", ")}. Se calculó con los estados de entrega de Moodle.`;
    const final = {
      conversationId,
      intent: "submissions",
      answer,
      data: { students },
      generatedAt: new Date().toISOString(),
      sources: [
        { type: "moodle_activity", id: 21, page: null, url: null },
        { type: "moodle_gradebook", id: body.courseId, page: null, url: null },
      ],
      incompleteData: /incompleto/i.test(message),
    };
    const history = conversations.get(conversationId) ?? { courseId: body.courseId, messages: [] };
    history.messages.push(
      { role: "user", content: message, createdAt: new Date().toISOString() },
      { role: "assistant", content: answer, createdAt: final.generatedAt },
    );
    conversations.set(conversationId, history);

    if (!String(request.headers.accept).includes("text/event-stream"))
      return json(response, 200, final);
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    sse(response, "tool", { name: "get_assignment_submissions" });
    await wait(delayMs);
    for (const word of answer.split(" ")) {
      sse(response, "token", { text: `${word} ` });
      await wait(delayMs / 8);
    }
    sse(response, "final", final);
    response.end();
  }

  function auditPage(response, query) {
    const limit = Number(query.get("limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      return error(
        response,
        400,
        "VALIDATION_ERROR",
        "La petición no cumple el formato esperado.",
        {
          details: [{ path: "limit", message: "Debe estar entre 1 y 200." }],
        },
      );
    const action = query.get("action");
    const matching = auditEvents.filter(
      (e) =>
        (!query.get("courseId") || e.courseId === Number(query.get("courseId"))) &&
        (!query.get("actorId") || e.actorMoodleId === Number(query.get("actorId"))) &&
        (!query.get("outcome") || e.outcome === query.get("outcome")) &&
        (!action || (action.endsWith(".") ? e.action.startsWith(action) : e.action === action)) &&
        (!query.get("from") || e.createdAt >= query.get("from")) &&
        (!query.get("to") || e.createdAt <= query.get("to")),
    );
    const start = Number(query.get("cursor") ?? 0);
    if (!Number.isInteger(start) || start < 0)
      return error(
        response,
        400,
        "VALIDATION_ERROR",
        "La petición no cumple el formato esperado.",
        {
          details: [{ path: "cursor", message: "El cursor no es válido." }],
        },
      );
    const items = matching.slice(start, start + limit);
    const next = start + limit < matching.length ? String(start + limit) : null;
    return json(response, 200, { items, nextCursor: next });
  }

  function rulesFor(courseId) {
    return {
      courseId: courseId ? Number(courseId) : null,
      rules: Object.keys(RULES).map((rule) => {
        const own = courseId ? savedRules.get(`${courseId}:${rule}`) : undefined;
        const institution = savedRules.get(`institution:${rule}`);
        const found = own ?? institution;
        return {
          rule,
          scope: own ? "course" : institution ? "institution" : "default",
          enabled: found?.enabled ?? true,
          params: found?.params ?? { ...RULES[rule] },
        };
      }),
    };
  }

  function putRule(response, rule, body) {
    const valid =
      Object.hasOwn(body, "courseId") &&
      typeof body.enabled === "boolean" &&
      (body.courseId === null || Number.isInteger(body.courseId)) &&
      Object.keys(body.params ?? {}).every((key) => key in RULES[rule]);
    if (!valid)
      return error(
        response,
        400,
        "VALIDATION_ERROR",
        "La petición no cumple el formato esperado.",
        {
          details: [{ path: "body", message: "Cuerpo inválido para esta regla." }],
        },
      );
    const scope = body.courseId === null ? "institution" : String(body.courseId);
    const saved = { enabled: body.enabled, params: { ...RULES[rule], ...body.params } };
    savedRules.set(`${scope}:${rule}`, saved);
    return json(response, 200, {
      rule,
      scope: body.courseId === null ? "institution" : "course",
      ...saved,
    });
  }

  function deleteRule(response, rule, courseId) {
    const key = `${courseId ?? "institution"}:${rule}`;
    if (!savedRules.delete(key)) return error(response, 404, "RULE_NOT_FOUND");
    response.writeHead(204);
    return response.end();
  }

  async function route(request, response) {
    const url = new URL(request.url, "http://mock");
    const path = url.pathname.startsWith(API) ? url.pathname.slice(API.length) : url.pathname;
    const { userId, courseId } = identity(request);
    const method = request.method;
    let match;

    if (method === "OPTIONS") return json(response, 204, {});
    if (path === "/health")
      return json(response, 200, { status: "ok", dependencies: { mock: "ok" } });
    if (path === "/session" && method === "GET") {
      return json(response, 200, {
        moodleUserId: userId,
        courseId,
        roles: ["editingteacher"],
        capabilities: { use: true, publish: true, viewanalytics: true, admin: true },
      });
    }

    if ((match = /^\/syllabi\/([^/]+)(\/extract|\/extraction)?$/.exec(path))) {
      if (match[1] !== syllabus.id) return error(response, 404, "SYLLABUS_NOT_FOUND");
      if (!match[2] && method === "GET") return json(response, 200, syllabusDto(courseId));
      if (match[2] === "/extract" && method === "POST") {
        if (syllabus.status !== "TEXT_READY" && syllabus.status !== "FAILED")
          return error(response, 409, "INVALID_TRANSITION");
        syllabus.status = "PROCESSING";
        setTimeout(() => {
          syllabus.extractions.push({
            version: 1,
            source: "AI",
            content: buildSyllabusExtraction(),
            createdAt: new Date().toISOString(),
          });
          syllabus.status = "EXTRACTED";
        }, delayMs * 4);
        return json(response, 202, syllabusDto(courseId));
      }
      if (match[2] === "/extraction") {
        if (method === "GET") {
          const wanted =
            Number(url.searchParams.get("version")) || syllabus.extractions.at(-1)?.version;
          const found = syllabus.extractions.find((e) => e.version === wanted);
          return found
            ? json(response, 200, extractionDto(found))
            : error(response, 404, "EXTRACTION_NOT_FOUND");
        }
        if (method === "PUT") {
          const parsed = syllabusExtractionSchema.safeParse(await readBody(request));
          if (!parsed.success) {
            return json(response, 400, {
              code: "VALIDATION_ERROR",
              message: "La extracción no cumple el esquema v1.",
              details: parsed.error.issues.map((i) => ({
                path: i.path.join("."),
                message: i.message,
              })),
            });
          }
          const saved = {
            version: (syllabus.extractions.at(-1)?.version ?? 0) + 1,
            source: "TEACHER",
            content: parsed.data,
            createdAt: new Date().toISOString(),
          };
          syllabus.extractions.push(saved);
          syllabus.status = "REVIEWED";
          return json(response, 201, extractionDto(saved));
        }
      }
    }

    if (path === "/assistant/chat" && method === "POST")
      return chat(request, response, (await readBody(request)) ?? {});
    if ((match = /^\/assistant\/conversations\/([^/]+)$/.exec(path)) && method === "GET") {
      const conversation = conversations.get(match[1]);
      return conversation
        ? json(response, 200, {
            id: match[1],
            courseId: conversation.courseId,
            messages: conversation.messages,
          })
        : error(response, 404, "CONVERSATION_NOT_FOUND");
    }

    if (path === "/audit" && method === "GET") return auditPage(response, url.searchParams);
    if (path === "/admin/difficulty-rules" && method === "GET")
      return json(response, 200, rulesFor(url.searchParams.get("courseId")));
    if ((match = /^\/admin\/difficulty-rules\/([A-Z_]+)$/.exec(path))) {
      if (!RULES[match[1]]) return error(response, 404, "RULE_NOT_FOUND");
      if (method === "PUT") return putRule(response, match[1], (await readBody(request)) ?? {});
      if (method === "DELETE")
        return deleteRule(response, match[1], url.searchParams.get("courseId"));
    }

    if ((match = /^\/analytics\/courses\/(\d+)$/.exec(path)) && method === "GET")
      return json(response, 200, analytics(Number(match[1])));
    if ((match = /^\/analytics\/courses\/(\d+)\/students\/(\d+)$/.exec(path)) && method === "GET")
      return json(response, 200, evidence(Number(match[1]), Number(match[2])));
    if (
      (match = /^\/analytics\/courses\/(\d+)\/students\/(\d+)\/recommendations$/.exec(path)) &&
      method === "POST"
    ) {
      // El estudiante 99 simula «datos insuficientes».
      return Number(match[2]) === 99
        ? error(response, 422, "INSUFFICIENT_DATA", "Datos insuficientes.")
        : json(response, 201, recommendation());
    }
    if (/^\/recommendations\/[^/]+\/followups$/.test(path) && method === "POST") {
      const body = await readBody(request);
      return body?.actionTaken ? json(response, 201, {}) : error(response, 400, "VALIDATION_ERROR");
    }

    return error(response, 404, "NOT_FOUND", "Ruta no simulada: es del backend real.");
  }

  return createServer((request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader(
      "access-control-allow-headers",
      "Authorization, Content-Type, Idempotency-Key, Accept",
    );
    response.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    response.setHeader("access-control-expose-headers", "Retry-After");
    route(request, response).catch(() => {
      if (!response.headersSent) error(response, 500, "INTERNAL_ERROR");
      else response.end();
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.MOCK_PORT ?? 3100);
  const studentIds = (process.env.MOCK_STUDENT_IDS ?? "3,5,6").split(",").map(Number);
  createMockApi({ studentIds }).listen(port, "127.0.0.1", () => {
    console.log(
      `API de IA simulada en http://localhost:${port}${API}  (sílabo de ejemplo: ${MOCK_SYLLABUS_ID})`,
    );
  });
}
