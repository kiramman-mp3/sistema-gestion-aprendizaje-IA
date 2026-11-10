import { randomUUID } from "node:crypto";
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import { AuditService } from "../audit/audit.service";
import type { AuthContext } from "../auth/auth-context";
import { parseBody } from "../common/parse-body";
import type { Env } from "../config/env";
import { PrismaService } from "../database/prisma.service";
import { IntegrationAccountService } from "../integrations/integration-account.service";
import type { LlmChatMessage } from "../llm/llm-provider";
import { LlmError } from "../llm/llm.errors";
import { PseudonymizerFactory } from "../privacy/pseudonymizer.factory";
import {
  AiOrchestratorService,
  CLARIFICATION_INTENT,
  type AssistantEvent,
} from "./ai-orchestrator.service";
import type { ChatSource } from "./tools/assistant-tool";
import { UsageLimitExceededError, UsageQuotaService } from "./usage-quota.service";

/** Mensajes previos que se entregan al modelo como contexto. */
export const HISTORY_MESSAGES = 20;

const chatBodySchema = z.object({
  courseId: z.number().int().positive(),
  conversationId: z.uuid().nullish(),
  message: z.string().trim().min(1).max(2000),
});

/** `components/schemas/ChatResponse` del contrato OpenAPI. */
export interface ChatResponseDto {
  conversationId: string;
  intent: string | null;
  answer: string;
  data: Record<string, unknown> | null;
  generatedAt: string;
  sources: ChatSource[];
  /** Reglas con las que se calcularon los datos de la respuesta; vacío si no se consultó nada. */
  criteria: string[];
  incompleteData: boolean;
}

export interface ConversationDto {
  id: string;
  courseId: number;
  messages: { role: "user" | "assistant"; content: string; createdAt: string }[];
}

/**
 * Casos de uso del chat (RF-10 a RF-14). Orden: validar → aislar por curso → cuota → conversación →
 * seudonimizar → orquestar → guardar. Nada se guarda si la IA falla: el docente reintenta sin dejar
 * mensajes sueltos, y el proveedor caído se informa sin inventar una respuesta.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: AiOrchestratorService,
    private readonly quota: UsageQuotaService,
    private readonly pseudonymizers: PseudonymizerFactory,
    private readonly accounts: IntegrationAccountService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async chat(
    auth: AuthContext,
    rawBody: unknown,
    emit?: (event: AssistantEvent) => void,
  ): Promise<ChatResponseDto> {
    const body = parseBody(chatBodySchema, rawBody);
    if (body.courseId !== auth.courseId) {
      throw new ForbiddenException({
        code: "FORBIDDEN_COURSE",
        message: "El token no corresponde a este curso.",
      });
    }
    try {
      await this.quota.assertWithinLimits(auth.moodleUserId);
    } catch (error) {
      // El rechazo por tope diario se audita: sirve a la alerta de consumo de IA (check-ai-usage.sh).
      if (error instanceof UsageLimitExceededError) {
        await this.record(auth, "DENIED", {}, "assistant.quota_exceeded");
      }
      throw error;
    }

    const existing = body.conversationId ? await this.findOwn(auth, body.conversationId) : null;
    const { messages: history, lastIntent } = existing
      ? await this.loadHistory(existing.id)
      : { messages: [], lastIntent: null };
    const pseudonymizer = this.pseudonymizers.create(auth.courseId);
    const message = pseudonymizer.pseudonymize(body.message);

    let result;
    try {
      result = await this.orchestrator.run({
        auth,
        history,
        message,
        // Una aclaración se pide una sola vez: si lo último fue una aclaración, ahora toca responder.
        canAskClarification: lastIntent !== CLARIFICATION_INTENT,
        pseudonymizer,
        emit,
      });
    } catch (error) {
      if (!(error instanceof LlmError)) throw error;
      await this.record(auth, "ERROR", { errorCode: error.code });
      // El contrato solo define AI_PROVIDER_UNAVAILABLE para el 503: tiempo agotado, tope de tokens
      // y salida inválida son, para el docente, el mismo "ahora no puedo responder".
      throw new ServiceUnavailableException({
        code: "AI_PROVIDER_UNAVAILABLE",
        message:
          error.code === "AI_LIMIT_EXCEEDED"
            ? "La conversación es demasiado larga. Inicia una conversación nueva."
            : "El asistente no está disponible en este momento. Inténtalo de nuevo en unos minutos.",
      });
    }

    const students = pseudonymizer.restore(result.answer);
    const conversationId = existing?.id ?? randomUUID();
    const generatedAt = new Date();
    await this.save(auth, conversationId, existing === null, message, result, generatedAt);
    await this.record(auth, "SUCCESS", {
      model: result.model,
      tools: result.toolsUsed.length,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      incomplete: result.incompleteData ? 1 : 0,
    });

    // Los nombres no pasan por el backend: el plugin resuelve cada seudónimo con el id de Moodle.
    const data =
      result.data || students.length > 0
        ? { ...(result.data ?? {}), ...(students.length > 0 ? { students } : {}) }
        : null;
    return {
      conversationId,
      intent: result.intent,
      answer: result.answer,
      data,
      generatedAt: generatedAt.toISOString(),
      sources: result.sources,
      criteria: result.criteria,
      incompleteData: result.incompleteData,
    };
  }

  /** Historial de una conversación propia. Una ajena responde 404 igual que una inexistente (SEC-10). */
  async getConversation(auth: AuthContext, id: string): Promise<ConversationDto> {
    const conversation = await this.findOwn(auth, id);
    const messages = await this.prisma.aiMessage.findMany({
      where: { conversationId: conversation.id, role: { in: ["USER", "ASSISTANT"] } },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true, createdAt: true },
    });
    return {
      id: conversation.id,
      courseId: conversation.moodleCourseId,
      messages: messages.map((m) => ({
        role: m.role === "USER" ? "user" : "assistant",
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  private async findOwn(auth: AuthContext, id: string) {
    const conversation = /^[0-9a-f-]{36}$/i.test(id)
      ? await this.prisma.aiConversation.findUnique({
          where: { id },
          select: { id: true, moodleUserId: true, moodleCourseId: true },
        })
      : null;
    if (
      !conversation ||
      conversation.moodleUserId !== auth.moodleUserId ||
      conversation.moodleCourseId !== auth.courseId
    ) {
      throw new NotFoundException({
        code: "CONVERSATION_NOT_FOUND",
        message: "La conversación no existe.",
      });
    }
    return conversation;
  }

  private async loadHistory(
    conversationId: string,
  ): Promise<{ messages: LlmChatMessage[]; lastIntent: string | null }> {
    const rows = await this.prisma.aiMessage.findMany({
      where: { conversationId, role: { in: ["USER", "ASSISTANT"] } },
      orderBy: { createdAt: "desc" },
      take: HISTORY_MESSAGES,
      select: { role: true, content: true, intent: true },
    });
    // `rows` viene del más nuevo al más viejo: el primer mensaje del asistente es el último que dijo.
    const lastIntent = rows.find((row) => row.role === "ASSISTANT")?.intent ?? null;
    return {
      lastIntent,
      messages: rows.reverse().map((row) => ({
        role: row.role === "USER" ? ("user" as const) : ("assistant" as const),
        content: row.content,
      })),
    };
  }

  private async save(
    auth: AuthContext,
    conversationId: string,
    isNew: boolean,
    userMessage: string,
    result: {
      answer: string;
      intent: string | null;
      model: string;
      usage: { inputTokens: number; outputTokens: number };
    },
    answeredAt: Date,
  ): Promise<void> {
    const retainUntil = new Date(
      answeredAt.getTime() +
        this.config.get("AI_CONVERSATION_RETENTION_DAYS", { infer: true }) * 24 * 60 * 60 * 1000,
    );
    const integrationAccountId = await this.accounts.currentId();
    await this.prisma.$transaction(async (tx) => {
      if (isNew) {
        await tx.aiConversation.create({
          data: {
            id: conversationId,
            integrationAccountId,
            moodleUserId: auth.moodleUserId,
            moodleCourseId: auth.courseId,
            retainUntil,
          },
        });
      } else {
        // Cada mensaje renueva el plazo de conservación de la conversación.
        await tx.aiConversation.update({ where: { id: conversationId }, data: { retainUntil } });
      }
      await tx.aiMessage.create({
        data: {
          conversationId,
          role: "USER",
          content: userMessage,
          createdAt: new Date(answeredAt.getTime() - 1),
        },
      });
      await tx.aiMessage.create({
        data: {
          conversationId,
          role: "ASSISTANT",
          content: result.answer,
          intent: result.intent,
          llmModel: result.model,
          tokensIn: result.usage.inputTokens,
          tokensOut: result.usage.outputTokens,
          createdAt: answeredAt,
        },
      });
    });
  }

  private async record(
    auth: AuthContext,
    outcome: "SUCCESS" | "ERROR" | "DENIED",
    metadata: Record<string, string | number>,
    action = "assistant.chat",
  ): Promise<void> {
    await this.audit
      .record({
        action,
        outcome,
        actorMoodleId: auth.moodleUserId,
        courseId: auth.courseId,
        resourceType: "ai_conversation",
        metadata,
      })
      .catch((error: unknown) =>
        this.logger.error(`No se pudo auditar el mensaje del chat: ${String(error)}`),
      );
  }
}
