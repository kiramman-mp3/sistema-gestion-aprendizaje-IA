import { buildSyllabusExtraction } from "@smart-lms/contracts";
import { LlmError } from "../llm.errors";
import {
  estimateTokens,
  LlmProvider,
  type LlmChatMessage,
  type LlmChatRequest,
  type LlmChatResponse,
  type LlmProviderRequest,
  type LlmProviderResponse,
} from "../llm-provider";

/** Aviso que acompaña a toda respuesta de este proveedor, para que nadie la confunda con una real. */
export const DEMO_NOTICE =
  "[Respuesta de demostración: no hay un proveedor de IA real configurado]";

/**
 * Proveedor de demostración (`AI_PROVIDER=mock`). Permite recorrer la aplicación de punta a punta mientras no
 * se elige proveedor (D-07): la extracción devuelve el sílabo de ejemplo de `@smart-lms/contracts` y el chat
 * consulta una herramienta según palabras clave y resume lo que ella devolvió.
 *
 * No entiende el documento ni la pregunta; no sirve para medir calidad ni tiempos. Pasa por los mismos
 * límites, validaciones y verificaciones que un proveedor real: por ejemplo, las fechas y ponderaciones del
 * sílabo de ejemplo que no estén en el documento subido se anulan y quedan marcadas para revisión. No se
 * permite en producción (`env.ts`).
 */
export class DemoLlmProvider extends LlmProvider {
  readonly name = "demo";

  async generateStructured(request: LlmProviderRequest): Promise<LlmProviderResponse> {
    if (request.schemaName === "pedagogical_recommendation_v1") {
      return this.demoRecommendation(request);
    }
    if (request.schemaName !== "syllabus_extraction_v1") {
      throw new LlmError(
        "AI_PROVIDER_UNAVAILABLE",
        `El proveedor de demostración no sabe responder «${request.schemaName}».`,
      );
    }
    const output = buildSyllabusExtraction();
    return {
      output,
      model: "demo-1",
      usage: {
        inputTokens: estimateTokens(request.system) + estimateTokens(request.prompt),
        outputTokens: estimateTokens(JSON.stringify(output)),
      },
    };
  }

  /** Recomendación de ejemplo, en lenguaje neutro: sirve para ver el flujo, no para decidir nada. */
  private async demoRecommendation(request: LlmProviderRequest): Promise<LlmProviderResponse> {
    const output = {
      evidenceSummary: [`${DEMO_NOTICE} Resumen de ejemplo de las evidencias disponibles.`],
      strengths: [],
      difficulties: [],
      missingInformation: [],
      strategies: [
        "Revisar con el estudiante las actividades pendientes y acordar una fecha de entrega.",
      ],
      reinforcementActivities: [],
      followUpIndicators: ["Entregas de las próximas dos semanas."],
    };
    return {
      output,
      model: "demo-1",
      usage: {
        inputTokens: estimateTokens(request.system) + estimateTokens(request.prompt),
        outputTokens: estimateTokens(JSON.stringify(output)),
      },
    };
  }

  async generateChat(request: LlmChatRequest): Promise<LlmChatResponse> {
    const inputTokens = estimateTokens(request.system + JSON.stringify(request.messages));
    const lastTool = [...request.messages].reverse().find((m) => m.role === "tool");
    const alreadyAnswered = lastTool !== undefined;

    if (!alreadyAnswered) {
      // Una pregunta sobre «la tarea» sin decir cuál es ambigua: la demostración pide una aclaración (si se le ofrece).
      if (
        request.tools.some((t) => t.name === "ask_clarification") &&
        isAmbiguous(lastUserText(request.messages))
      ) {
        return {
          kind: "tool_calls",
          calls: [
            {
              id: `demo-${request.messages.length}`,
              name: "ask_clarification",
              arguments: { question: "¿De qué tarea hablas? Dime su número o su nombre." },
            },
          ],
          model: "demo-1",
          usage: { inputTokens, outputTokens: 20 },
        };
      }
      const tool = chooseTool(
        lastUserText(request.messages),
        request.tools.map((t) => t.name),
      );
      if (tool) {
        const question = lastUserText(request.messages);
        return {
          kind: "tool_calls",
          calls: [
            {
              id: `demo-${request.messages.length}`,
              name: tool,
              // La búsqueda en documentos necesita la pregunta; las demás herramientas no reciben argumentos.
              arguments: tool === "search_course_documents" ? { query: question } : {},
            },
          ],
          model: "demo-1",
          usage: { inputTokens, outputTokens: 20 },
        };
      }
    }

    const text = lastTool
      ? summarize(lastTool)
      : `${DEMO_NOTICE} No tengo una herramienta para esa consulta.`;
    for (const piece of text.match(/\S+\s*/g) ?? []) request.onToken?.(piece);
    return {
      kind: "text",
      text,
      model: "demo-1",
      usage: { inputTokens, outputTokens: estimateTokens(text) },
    };
  }
}

function lastUserText(messages: LlmChatMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  return last?.content.toLowerCase() ?? "";
}

/** «¿Quién no entregó la tarea?»: habla de entregas de una tarea sin decir cuál (ni número ni nombre). */
function isAmbiguous(question: string): boolean {
  return (
    /\b(la|esa|esta) tarea\b/.test(question) && /entreg/.test(question) && !/\d/.test(question)
  );
}

/** Elige la herramienta por palabras clave; solo entre las que la petición ofrece. */
function chooseTool(question: string, available: string[]): string | null {
  const wanted =
    /document|silabo|sílabo|bibliograf|metodolog|objetivo|programa anal|criterios? de evaluaci/.test(
      question,
    )
      ? "search_course_documents"
      : /unidad|rendimiento/.test(question)
        ? "get_unit_performance"
        : /pendiente|calificar|corregir/.test(question)
          ? "get_pending_grading"
          : /nota|promedio|calificaci/.test(question)
            ? "get_grade_summary"
            : /actividad|tarea|foro|cuestionario/.test(question)
              ? "get_course_activities"
              : null;
  return wanted !== null && available.includes(wanted) ? wanted : null;
}

function summarize(message: Extract<LlmChatMessage, { role: "tool" }>): string {
  if (/"error"\s*:/.test(message.content)) {
    return `${DEMO_NOTICE} No pude consultar «${message.name}»: la consulta falló o Moodle todavía no tiene esa función.`;
  }
  const data =
    /<resultado_herramienta[^>]*>\s*([\s\S]*?)\s*<\/resultado_herramienta>/.exec(
      message.content,
    )?.[1] ?? "";
  if (message.name === "search_course_documents") return summarizeDocuments(data);
  const shown = data.length > 400 ? `${data.slice(0, 400)}…` : data;
  return `${DEMO_NOTICE} Consulté «${message.name}» y obtuve: ${shown}`;
}

/** Respuesta de demostración a una búsqueda en documentos: cita el pasaje más cercano y su página, o dice que no halló nada. */
function summarizeDocuments(data: string): string {
  try {
    const parsed = JSON.parse(data) as { passages?: { page: number | null; text: string }[] };
    const first = parsed.passages?.[0];
    if (!first) {
      return `${DEMO_NOTICE} No encontré esa información en los documentos del curso.`;
    }
    const where = first.page ? ` (página ${first.page})` : "";
    const text = first.text.length > 300 ? `${first.text.slice(0, 300)}…` : first.text;
    return `${DEMO_NOTICE} Según el documento del curso${where}: «${text}»`;
  } catch {
    return `${DEMO_NOTICE} No pude leer el resultado de la búsqueda en los documentos.`;
  }
}
