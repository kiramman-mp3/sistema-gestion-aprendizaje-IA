import { Body, Controller, Get, Headers, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { Auth, type AuthContext } from "../auth/auth-context";
import { LlmError } from "../llm/llm.errors";
import type { AssistantEvent } from "./ai-orchestrator.service";
import { ChatService, type ConversationDto } from "./chat.service";

@Controller("assistant")
export class AssistantController {
  constructor(private readonly chat: ChatService) {}

  /**
   * Mensaje al asistente (RF-10 a RF-14). Con `Accept: text/event-stream` responde por SSE (`tool`,
   * `token`, `final`, `error`); si no, un JSON con la respuesta completa. Un fallo antes del primer evento
   * (permiso, límite de uso, proveedor caído) sale como JSON con su código HTTP; después del primer evento
   * ya no se puede cambiar el estado y se informa con un evento `error`.
   */
  @Post("chat")
  async send(
    @Auth() auth: AuthContext,
    @Body() body: unknown,
    @Headers("accept") accept: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    if (!accept?.toLowerCase().includes("text/event-stream")) {
      response.status(200).json(await this.chat.chat(auth, body));
      return;
    }

    let started = false;
    const open = (): void => {
      if (started) return;
      started = true;
      response.status(200);
      response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      response.setHeader("Cache-Control", "no-cache, no-transform");
      response.setHeader("X-Accel-Buffering", "no");
      response.flushHeaders();
    };
    const write = (event: string, data: unknown): void => {
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const final = await this.chat.chat(auth, body, (event: AssistantEvent) => {
        open();
        write(event.type, event.type === "tool" ? { name: event.name } : { text: event.text });
      });
      open();
      write("final", final);
    } catch (error) {
      // Antes del primer evento, el filtro de errores responde con el código HTTP del contrato.
      if (!started) throw error;
      write("error", {
        code: error instanceof LlmError ? error.code : "INTERNAL_ERROR",
        message: "El asistente no pudo completar la respuesta.",
      });
    } finally {
      if (started) response.end();
    }
  }

  /** Historial de una conversación propia; una ajena responde 404 (SEC-10). */
  @Get("conversations/:conversationId")
  conversation(
    @Auth() auth: AuthContext,
    @Param("conversationId") id: string,
  ): Promise<ConversationDto> {
    return this.chat.getConversation(auth, id);
  }
}
