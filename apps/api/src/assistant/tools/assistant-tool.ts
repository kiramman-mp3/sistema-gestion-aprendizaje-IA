import { Injectable } from "@nestjs/common";
import { z } from "zod";
import type { AuthContext } from "../../auth/auth-context";
import type { LlmToolSpec } from "../../llm/llm-provider";
import type { Pseudonymizer } from "../../privacy/pseudonymizer";

/** Origen de un dato en la respuesta; `sources[].type` decide el enlace que muestra el plugin. */
export interface ChatSource {
  type: "moodle_activity" | "moodle_gradebook" | "document";
  id: number | string;
  page?: number | null;
  url?: string | null;
}

/** Contexto de una llamada a herramienta: el docente del token y el seudonimizador de la petición. */
export interface ToolContext {
  auth: AuthContext;
  pseudonymizer: Pseudonymizer;
}

/**
 * Lo que devuelve una herramienta al modelo. `data` solo debe llevar datos ya seudonimizados: el
 * orquestador no revisa su contenido, quien escribe la herramienta es responsable de no incluir
 * nombres ni datos personales (ADR-010).
 */
export interface ToolOutput {
  data: Record<string, unknown>;
  sources: ChatSource[];
  /** Verdadero si la herramienta no pudo traer todos los datos pedidos. */
  incomplete?: boolean;
  /** Intención que se informa al plugin, por ejemplo `pending_submissions`. */
  intent?: string;
}

/**
 * Herramienta del asistente. Las de lectura solo consultan; las de escritura cambiarían datos y
 * exigen confirmación explícita del docente, por eso nunca se ofrecen al modelo en el bucle de chat.
 */
export interface AssistantTool<I = unknown> {
  readonly name: string;
  /** Qué hace y cuándo usarla; es lo que lee el modelo. */
  readonly description: string;
  readonly kind: "read" | "write";
  /** Esquema de los argumentos; se valida siempre antes de ejecutar. */
  readonly input: z.ZodType<I>;
  execute(context: ToolContext, input: I): Promise<ToolOutput>;
}

export const ASSISTANT_TOOLS = Symbol("ASSISTANT_TOOLS");

/** Registro de herramientas disponibles. Se inyecta la lista con el token `ASSISTANT_TOOLS`. */
@Injectable()
export class ToolRegistry {
  private readonly byName = new Map<string, AssistantTool>();

  constructor(tools: AssistantTool[] = []) {
    for (const tool of tools) {
      if (this.byName.has(tool.name)) {
        throw new Error(`La herramienta ${tool.name} está registrada dos veces.`);
      }
      this.byName.set(tool.name, tool);
    }
  }

  /** Solo las de lectura: es lo único que el modelo puede pedir por sí mismo. */
  readTool(name: string): AssistantTool | undefined {
    const tool = this.byName.get(name);
    return tool?.kind === "read" ? tool : undefined;
  }

  readSpecs(): LlmToolSpec[] {
    return [...this.byName.values()]
      .filter((tool) => tool.kind === "read")
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: z.toJSONSchema(tool.input) as Record<string, unknown>,
      }));
  }
}
