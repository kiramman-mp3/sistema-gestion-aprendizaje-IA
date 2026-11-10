import type { ConfigService } from "@nestjs/config";
import type { AuditService } from "../audit/audit.service";
import type { Env } from "../config/env";
import type { PrismaService } from "../database/prisma.service";
import type { IntegrationAccountService } from "../integrations/integration-account.service";
import { LlmService } from "../llm/llm.service";
import { MockLlmProvider } from "../llm/providers/mock-llm.provider";
import { PseudonymizerFactory } from "../privacy/pseudonymizer.factory";
import { AiOrchestratorService } from "./ai-orchestrator.service";
import { ChatService } from "./chat.service";
import { z } from "zod";
import { ToolRegistry, type AssistantTool } from "./tools/assistant-tool";
import { UsageLimitExceededError, type UsageQuotaService } from "./usage-quota.service";

const AUTH = { moodleUserId: 42, courseId: 7 };
const OTHER_USER = { moodleUserId: 43, courseId: 7 };
const SECRET = "una-clave-de-prueba-de-al-menos-32-caracteres";
const LIMITS = { maxInputTokens: 32_000, maxOutputTokens: 8_192, timeoutMs: 5_000 };

interface Conversation {
  id: string;
  moodleUserId: number;
  moodleCourseId: number;
  retainUntil: Date;
}
interface Message {
  conversationId: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt: Date;
  tokensIn?: number;
  tokensOut?: number;
  intent?: string | null;
  llmModel?: string;
}

function setup(options: { quota?: () => Promise<void>; tools?: AssistantTool[] } = {}) {
  const conversations: Conversation[] = [];
  const messages: Message[] = [];
  const tx = {
    aiConversation: {
      create: async ({ data }: { data: Conversation }) => void conversations.push({ ...data }),
      update: async ({ where, data }: { where: { id: string }; data: Partial<Conversation> }) =>
        void Object.assign(
          conversations.find((c) => c.id === where.id)!,
          data,
        ),
    },
    aiMessage: { create: async ({ data }: { data: Message }) => void messages.push({ ...data }) },
  };
  const prisma = {
    aiConversation: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        conversations.find((c) => c.id === where.id) ?? null,
    },
    aiMessage: {
      findMany: async ({
        where,
        take,
        orderBy,
      }: {
        where: { conversationId: string };
        take?: number;
        orderBy: { createdAt: "asc" | "desc" };
      }) => {
        const rows = messages
          .filter((m) => m.conversationId === where.conversationId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        if (orderBy.createdAt === "desc") rows.reverse();
        return rows.slice(0, take);
      },
    },
    $transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
  };

  const provider = new MockLlmProvider();
  provider.respondToChatWith(() => ({ kind: "text", text: "Respuesta del asistente." }));
  const llm = new LlmService(provider, { record: () => undefined }, LIMITS);
  const config = {
    get: (key: string) => ({ PSEUDONYM_SECRET: SECRET, AI_CONVERSATION_RETENTION_DAYS: 90 })[key],
  } as unknown as ConfigService<Env, true>;
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const quota = { assertWithinLimits: options.quota ?? (async () => undefined) };
  const service = new ChatService(
    prisma as unknown as PrismaService,
    new AiOrchestratorService(llm, new ToolRegistry(options.tools ?? [])),
    quota as unknown as UsageQuotaService,
    new PseudonymizerFactory(config),
    { currentId: async () => "cuenta-1" } as unknown as IntegrationAccountService,
    audit as unknown as AuditService,
    config,
  );
  return { service, provider, conversations, messages, audit };
}

const body = (overrides = {}) => ({ courseId: 7, message: "Hola", ...overrides });

describe("ChatService", () => {
  describe("chat", () => {
    it("crea la conversación, guarda el mensaje y la respuesta y devuelve el contrato", async () => {
      const { service, conversations, messages } = setup();

      const result = await service.chat(AUTH, body());

      expect(result).toMatchObject({
        answer: "Respuesta del asistente.",
        intent: null,
        data: null,
        sources: [],
        incompleteData: false,
      });
      expect(result.conversationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(conversations).toEqual([
        expect.objectContaining({ id: result.conversationId, moodleUserId: 42, moodleCourseId: 7 }),
      ]);
      expect(messages.map((m) => [m.role, m.content])).toEqual([
        ["USER", "Hola"],
        ["ASSISTANT", "Respuesta del asistente."],
      ]);
      expect(messages[1]).toMatchObject({ llmModel: "mock-1" });
      expect(messages[1]!.tokensIn).toBeGreaterThan(0);
    });

    it("continúa una conversación propia con su historial", async () => {
      const { service, provider, conversations, messages } = setup();
      const first = await service.chat(AUTH, body({ message: "Primera" }));

      const second = await service.chat(
        AUTH,
        body({ conversationId: first.conversationId, message: "Segunda" }),
      );

      expect(second.conversationId).toBe(first.conversationId);
      expect(conversations).toHaveLength(1);
      expect(messages).toHaveLength(4);
      expect(provider.chatCalls[1]!.messages.map((m) => m.role)).toEqual([
        "user",
        "assistant",
        "user",
      ]);
    });

    it("responde 404 si la conversación es de otro usuario, igual que si no existe (SEC-10)", async () => {
      const { service } = setup();
      const mine = await service.chat(AUTH, body());

      await expect(
        service.chat(OTHER_USER, body({ conversationId: mine.conversationId })),
      ).rejects.toMatchObject({ response: { code: "CONVERSATION_NOT_FOUND" } });
      await expect(
        service.chat(AUTH, body({ conversationId: "00000000-0000-4000-8000-000000000000" })),
      ).rejects.toMatchObject({ response: { code: "CONVERSATION_NOT_FOUND" } });
    });

    it("responde 404 si la conversación es del mismo docente pero de otro curso (SEC-10)", async () => {
      const { service } = setup();
      const mine = await service.chat(AUTH, body());
      const otherCourse = { moodleUserId: 42, courseId: 8 };

      await expect(
        service.chat(otherCourse, body({ courseId: 8, conversationId: mine.conversationId })),
      ).rejects.toMatchObject({ response: { code: "CONVERSATION_NOT_FOUND" } });
      await expect(service.getConversation(otherCourse, mine.conversationId)).rejects.toMatchObject(
        {
          response: { code: "CONVERSATION_NOT_FOUND" },
        },
      );
    });

    it("responde 403 si el curso del cuerpo no es el del token", async () => {
      const { service, provider } = setup();

      await expect(service.chat(AUTH, body({ courseId: 99 }))).rejects.toMatchObject({
        response: { code: "FORBIDDEN_COURSE" },
      });
      expect(provider.chatCalls).toHaveLength(0);
    });

    it.each([
      ["sin mensaje", { message: "   " }],
      ["mensaje largo", { message: "a".repeat(2001) }],
      ["curso inválido", { courseId: "7" }],
      ["conversación inválida", { conversationId: "no-uuid" }],
    ])("responde 400 con %s", async (_name, overrides) => {
      const { service } = setup();

      await expect(service.chat(AUTH, body(overrides))).rejects.toMatchObject({
        response: { code: "VALIDATION_ERROR" },
      });
    });

    it("responde 429 antes de llamar al proveedor si se agotó la cuota", async () => {
      const { service, provider } = setup({
        quota: async () => {
          throw new UsageLimitExceededError(3600);
        },
      });

      await expect(service.chat(AUTH, body())).rejects.toMatchObject({
        retryAfterSeconds: 3600,
        response: { code: "RATE_LIMITED" },
      });
      expect(provider.chatCalls).toHaveLength(0);
    });

    it("responde 503 AI_PROVIDER_UNAVAILABLE y no guarda nada si el proveedor falla", async () => {
      const { service, provider, conversations, messages } = setup();
      provider.respondToChatWith(() => {
        throw new Error("caído");
      });

      await expect(service.chat(AUTH, body())).rejects.toMatchObject({
        response: { code: "AI_PROVIDER_UNAVAILABLE" },
      });
      expect(conversations).toHaveLength(0);
      expect(messages).toHaveLength(0);
    });

    it("quita correos y cédulas del mensaje antes de enviarlo al modelo y de guardarlo", async () => {
      const { service, provider, messages } = setup();

      await service.chat(AUTH, body({ message: "Escribe a ana@uta.edu.ec, cédula 1801234567" }));

      const sent = provider.chatCalls[0]!.messages.at(-1) as { content: string };
      expect(sent.content).toBe("Escribe a [correo], cédula [número]");
      expect(messages[0]!.content).toBe("Escribe a [correo], cédula [número]");
    });

    it("informa los ids de los seudónimos que aparecen en la respuesta, no nombres", async () => {
      const tool: AssistantTool<Record<string, never>> = {
        name: "get_pending_submissions",
        description: "Pendientes.",
        kind: "read",
        input: z.object({}),
        execute: async ({ pseudonymizer }) => ({
          data: { students: [pseudonymizer.alias(1001)] },
          sources: [{ type: "moodle_activity", id: 15 }],
          intent: "pending_submissions",
        }),
      };
      const { service, provider } = setup({ tools: [tool as AssistantTool] });
      provider.respondToChatWith((request, turn) => {
        if (turn === 0) {
          return {
            kind: "tool_calls",
            calls: [{ id: "c1", name: "get_pending_submissions", arguments: {} }],
          };
        }
        const alias = /Estudiante#\d{8}/.exec(JSON.stringify(request.messages))![0];
        return { kind: "text", text: `${alias} no entregó.` };
      });

      const result = await service.chat(AUTH, body());

      const students = (result.data as { students: { alias: string; studentId: number }[] })
        .students;
      expect(students).toEqual([
        { alias: expect.stringMatching(/^Estudiante#\d{8}$/), studentId: 1001 },
      ]);
      expect(result.answer).toBe(`${students[0]!.alias} no entregó.`);
      expect(result.intent).toBe("pending_submissions");
      expect(result.sources).toEqual([{ type: "moodle_activity", id: 15 }]);
    });

    it("audita el mensaje solo con metadatos escalares", async () => {
      const { service, audit } = setup();

      await service.chat(AUTH, body({ message: "Texto privado del docente" }));

      const entry = audit.record.mock.calls[0]![0] as { action: string; metadata: object };
      expect(entry.action).toBe("assistant.chat");
      expect(JSON.stringify(entry)).not.toContain("Texto privado");
      for (const value of Object.values(entry.metadata)) {
        expect(["string", "number"]).toContain(typeof value);
      }
    });
  });

  describe("getConversation", () => {
    it("devuelve el historial en orden con los roles del contrato", async () => {
      const { service } = setup();
      const sent = await service.chat(AUTH, body({ message: "Hola" }));

      const conversation = await service.getConversation(AUTH, sent.conversationId);

      expect(conversation).toMatchObject({ id: sent.conversationId, courseId: 7 });
      expect(conversation.messages.map((m) => [m.role, m.content])).toEqual([
        ["user", "Hola"],
        ["assistant", "Respuesta del asistente."],
      ]);
    });

    it("responde 404 si es de otro usuario o el id es inválido", async () => {
      const { service } = setup();
      const sent = await service.chat(AUTH, body());

      await expect(service.getConversation(OTHER_USER, sent.conversationId)).rejects.toMatchObject({
        response: { code: "CONVERSATION_NOT_FOUND" },
      });
      await expect(service.getConversation(AUTH, "x")).rejects.toMatchObject({
        response: { code: "CONVERSATION_NOT_FOUND" },
      });
    });
  });
});

describe("ChatService · aclaración única y criterio aplicado", () => {
  const clarify = () => ({
    kind: "tool_calls" as const,
    calls: [
      { id: "c1", name: "ask_clarification", arguments: { question: "¿De qué tarea hablas?" } },
    ],
  });
  const names = (provider: MockLlmProvider, call: number) =>
    provider.chatCalls[call]!.tools.map((t) => t.name);

  it("guarda la aclaración con su intención y la devuelve como respuesta", async () => {
    const { service, provider, messages } = setup();
    provider.respondToChatWith(clarify);

    const result = await service.chat(AUTH, body({ message: "¿Quién no entregó la tarea?" }));

    expect(result).toMatchObject({
      answer: "¿De qué tarea hablas?",
      intent: "clarification",
      data: null,
    });
    expect(messages.at(-1)).toMatchObject({ role: "ASSISTANT", intent: "clarification" });
  });

  it("después de una aclaración ya no se le ofrece al modelo; con una respuesta normal, vuelve a ofrecerse", async () => {
    const { service, provider } = setup();
    provider.respondToChatWith(clarify);
    const first = await service.chat(AUTH, body({ message: "¿Quién no entregó la tarea?" }));
    provider.respondToChatWith(() => ({ kind: "text", text: "Con la tarea 3: nadie." }));

    const second = await service.chat(
      AUTH,
      body({ conversationId: first.conversationId, message: "La tarea 3" }),
    );
    await service.chat(
      AUTH,
      body({ conversationId: first.conversationId, message: "Y la tarea 4" }),
    );

    expect(second.intent).not.toBe("clarification");
    expect(names(provider, 0)).toContain("ask_clarification");
    expect(names(provider, 1)).not.toContain("ask_clarification");
    expect(names(provider, 2)).toContain("ask_clarification");
  });

  it("devuelve el criterio aplicado de las herramientas usadas", async () => {
    const tool: AssistantTool<Record<string, never>> = {
      name: "get_pending_grading",
      description: "Pendientes",
      kind: "read",
      input: z.object({}),
      execute: async () => ({
        data: { totalPending: 1 },
        sources: [],
        criteria: ["Pendiente de calificar es una entrega enviada sin nota."],
      }),
    };
    const { service, provider } = setup({ tools: [tool] });
    provider.respondToChatWith((_request, turn) =>
      turn === 0
        ? { kind: "tool_calls", calls: [{ id: "1", name: "get_pending_grading", arguments: {} }] }
        : { kind: "text", text: "Hay 1 pendiente." },
    );

    const result = await service.chat(AUTH, body({ message: "¿Qué hay pendiente?" }));

    expect(result.criteria).toEqual(["Pendiente de calificar es una entrega enviada sin nota."]);
  });

  it("una respuesta sin herramientas no trae criterio", async () => {
    const { service } = setup();

    expect((await service.chat(AUTH, body())).criteria).toEqual([]);
  });
});
