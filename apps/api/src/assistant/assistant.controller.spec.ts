import { ServiceUnavailableException } from "@nestjs/common";
import type { Response } from "express";
import { LlmError } from "../llm/llm.errors";
import type { AssistantEvent } from "./ai-orchestrator.service";
import { AssistantController } from "./assistant.controller";
import type { ChatResponseDto, ChatService } from "./chat.service";

const AUTH = { moodleUserId: 42, courseId: 7 };
const FINAL: ChatResponseDto = {
  conversationId: "00000000-0000-4000-8000-000000000001",
  intent: null,
  answer: "Dos entregas.",
  data: null,
  generatedAt: "2026-11-10T12:00:00.000Z",
  sources: [],
  criteria: [],
  incompleteData: false,
};

function fakeResponse() {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  const response = {
    statusCode: 0,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json: jest.fn(),
    setHeader: (name: string, value: string) => void (headers[name] = value),
    flushHeaders: jest.fn(),
    write: (chunk: string) => void chunks.push(chunk),
    end: jest.fn(),
  };
  return { response: response as unknown as Response & typeof response, chunks, headers };
}

function controller(chat: (emit?: (event: AssistantEvent) => void) => Promise<ChatResponseDto>) {
  return new AssistantController({
    chat: (_auth: unknown, _body: unknown, emit?: (event: AssistantEvent) => void) => chat(emit),
  } as unknown as ChatService);
}

/** Convierte lo escrito en eventos `{event, data}` como lo haría el lector del plugin. */
function parse(chunks: string[]) {
  return chunks
    .join("")
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const [event, data] = block.split("\n");
      return {
        event: event!.replace("event: ", ""),
        data: JSON.parse(data!.replace("data: ", "")),
      };
    });
}

describe("AssistantController.send", () => {
  it("responde JSON completo si el cliente no pide SSE", async () => {
    const { response } = fakeResponse();

    await controller(async () => FINAL).send(AUTH, {}, "application/json", response);

    expect(response.statusCode).toBe(200);
    expect(response.json).toHaveBeenCalledWith(FINAL);
  });

  it("envía tool, token y un único final en orden por SSE", async () => {
    const { response, chunks, headers } = fakeResponse();
    const handler = controller(async (emit) => {
      emit?.({ type: "tool", name: "get_assignment_submissions" });
      emit?.({ type: "token", text: "Dos " });
      emit?.({ type: "token", text: "entregas." });
      return FINAL;
    });

    await handler.send(AUTH, {}, "text/event-stream", response);

    expect(headers["Content-Type"]).toContain("text/event-stream");
    expect(headers["Cache-Control"]).toContain("no-cache");
    expect(parse(chunks)).toEqual([
      { event: "tool", data: { name: "get_assignment_submissions" } },
      { event: "token", data: { text: "Dos " } },
      { event: "token", data: { text: "entregas." } },
      { event: "final", data: FINAL },
    ]);
    expect(response.end).toHaveBeenCalledTimes(1);
  });

  it("deja que un fallo antes del primer evento salga como JSON con su código HTTP", async () => {
    const { response, chunks } = fakeResponse();
    const failure = new ServiceUnavailableException({ code: "AI_PROVIDER_UNAVAILABLE" });

    await expect(
      controller(async () => {
        throw failure;
      }).send(AUTH, {}, "text/event-stream", response),
    ).rejects.toBe(failure);

    expect(chunks).toHaveLength(0);
    expect(response.flushHeaders).not.toHaveBeenCalled();
    expect(response.end).not.toHaveBeenCalled();
  });

  it("informa con un evento error si el flujo falla después de empezar", async () => {
    const { response, chunks } = fakeResponse();
    const handler = controller(async (emit) => {
      emit?.({ type: "token", text: "Dos " });
      throw new LlmError("AI_TIMEOUT", "El proveedor no respondió.");
    });

    await handler.send(AUTH, {}, "text/event-stream", response);

    const events = parse(chunks);
    expect(events.map((e) => e.event)).toEqual(["token", "error"]);
    expect(events[1]!.data).toMatchObject({ code: "AI_TIMEOUT" });
    expect(JSON.stringify(events[1])).not.toContain("El proveedor no respondió");
    expect(response.end).toHaveBeenCalledTimes(1);
  });

  it("no filtra el mensaje de un error inesperado", async () => {
    const { response, chunks } = fakeResponse();
    const handler = controller(async (emit) => {
      emit?.({ type: "token", text: "x" });
      throw new Error("password=secreto");
    });

    await handler.send(AUTH, {}, "text/event-stream", response);

    expect(chunks.join("")).not.toContain("secreto");
    expect(parse(chunks).at(-1)).toMatchObject({
      event: "error",
      data: { code: "INTERNAL_ERROR" },
    });
  });
});
