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

  async generateChat(request: LlmChatRequest): Promise<LlmChatResponse> {
    const inputTokens = estimateTokens(request.system + JSON.stringify(request.messages));
    const lastTool = [...request.messages].reverse().find((m) => m.role === "tool");
    const alreadyAnswered = lastTool !== undefined;

    if (!alreadyAnswered) {
      const tool = chooseTool(
        lastUserText(request.messages),
        request.tools.map((t) => t.name),
      );
      if (tool) {
        return {
          kind: "tool_calls",
          calls: [{ id: `demo-${request.messages.length}`, name: tool, arguments: {} }],
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

/** Elige la herramienta por palabras clave; solo entre las que la petición ofrece. */
function chooseTool(question: string, available: string[]): string | null {
  const wanted = /unidad|rendimiento/.test(question)
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
  const shown = data.length > 400 ? `${data.slice(0, 400)}…` : data;
  return `${DEMO_NOTICE} Consulté «${message.name}» y obtuve: ${shown}`;
}
