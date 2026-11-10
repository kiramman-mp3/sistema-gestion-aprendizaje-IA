// This file is part of Moodle - https://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <https://www.gnu.org/licenses/>.

/**
 * Pure logic of the chat: the conversation state, how each streamed event changes it, and links to sources.
 *
 * The events and their data are the contract of `POST /assistant/chat` (docs/api/openapi.yaml):
 *
 * - `token`: `{"text": "..."}`, a piece of the answer.
 * - `tool`: `{"name": "get_assignment_submissions"}`, the assistant is consulting data.
 * - `final`: the complete `ChatResponse`. Its `answer` replaces what was streamed.
 * - `error`: `{"code": "...", "message": "..."}`. No answer is invented.
 *
 * No function changes its input.
 *
 * @module     local_ai_assistant/chat_model
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/** Same limit as the API (`message.maxLength`). */
export const MAX_MESSAGE_LENGTH = 2000;

/**
 * An empty conversation.
 *
 * @returns {{conversationId: string|null, messages: object[]}}
 */
export const emptyConversation = () => ({ conversationId: null, messages: [] });

/**
 * Cleans what the teacher typed.
 *
 * @param {string} text
 * @returns {string} The trimmed text, or "" if it cannot be sent.
 */
export const cleanMessage = (text) => text.trim();

/**
 * Whether a message can be sent.
 *
 * @param {string} text
 * @returns {boolean}
 */
export const canSend = (text) => {
  const clean = cleanMessage(text);
  return clean.length > 0 && clean.length <= MAX_MESSAGE_LENGTH;
};

/**
 * Body for `POST /assistant/chat`.
 *
 * @param {{conversationId: string|null}} conversation
 * @param {number} courseId
 * @param {string} text
 * @returns {{courseId: number, conversationId: string|null, message: string}}
 */
export const toChatRequest = (conversation, courseId, text) => ({
  courseId,
  conversationId: conversation.conversationId,
  message: cleanMessage(text),
});

/**
 * Adds the teacher's message and an empty assistant message that the stream will fill.
 *
 * @param {object} conversation
 * @param {string} text
 * @returns {object}
 */
export const startTurn = (conversation, text) => ({
  ...conversation,
  messages: [
    ...conversation.messages,
    { role: "user", text: cleanMessage(text), status: "done" },
    { role: "assistant", text: "", status: "streaming", tools: [], sources: [], incompleteData: false, generatedAt: null, errorCode: null },
  ],
});

/**
 * Parses the data of an event; a malformed one is ignored instead of breaking the conversation.
 *
 * @param {string} data
 * @returns {object|null}
 */
const parseData = (data) => {
  try {
    const value = JSON.parse(data);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
};

const withLast = (conversation, change) => {
  const messages = [...conversation.messages];
  const last = messages.length - 1;
  messages[last] = { ...messages[last], ...change(messages[last]) };
  return { ...conversation, messages };
};

/**
 * Applies one streamed event to the last (assistant) message.
 *
 * @param {object} conversation
 * @param {{event: string, data: string}} event
 * @returns {object}
 */
export const applyEvent = (conversation, event) => {
  const data = parseData(event.data);
  if (!data) {
    return conversation;
  }
  switch (event.event) {
    case "token":
      return typeof data.text === "string" ? withLast(conversation, (message) => ({ text: message.text + data.text })) : conversation;
    case "tool":
      return typeof data.name === "string"
        ? withLast(conversation, (message) => ({ tools: message.tools.includes(data.name) ? message.tools : [...message.tools, data.name] }))
        : conversation;
    case "final":
      return {
        ...withLast(conversation, () => ({
          text: String(data.answer ?? ""),
          status: "done",
          sources: Array.isArray(data.sources) ? data.sources : [],
          incompleteData: data.incompleteData === true,
          generatedAt: data.generatedAt ?? null,
        })),
        conversationId: data.conversationId ?? conversation.conversationId,
      };
    case "error":
      return withLast(conversation, () => ({ status: "error", errorCode: String(data.code ?? "ERROR") }));
    default:
      return conversation;
  }
};

/**
 * Marks the answer as failed, for example when the connection drops. A partial answer is kept but not
 * trusted: the interface shows the error next to it.
 *
 * @param {object} conversation
 * @param {string} errorCode
 * @returns {object}
 */
export const failTurn = (conversation, errorCode) => withLast(conversation, () => ({ status: "error", errorCode }));

/**
 * Closes a stream that ended without a `final` event: what arrived is not a complete answer.
 *
 * @param {object} conversation
 * @returns {object}
 */
export const closeTurn = (conversation) => {
  const last = conversation.messages.at(-1);
  return last?.role === "assistant" && last.status === "streaming" ? failTurn(conversation, "STREAM_INTERRUPTED") : conversation;
};

/**
 * The name of the message to show for an error code.
 *
 * @param {string|undefined} code Code from the API or from the stream.
 * @param {number} [status] HTTP status, when the error came before the stream started.
 * @returns {string} One of `ratelimited`, `unavailable`, `forbidden`, `interrupted`, `other`.
 */
export const errorKind = (code, status) => {
  if (status === 429 || code === "RATE_LIMITED") {
    return "ratelimited";
  }
  if (status === 503 || code === "SERVICE_UNAVAILABLE" || code === "AI_PROVIDER_UNAVAILABLE") {
    return "unavailable";
  }
  if (status === 403 || (code && code.startsWith("FORBIDDEN"))) {
    return "forbidden";
  }
  if (code === "STREAM_INTERRUPTED") {
    return "interrupted";
  }
  return "other";
};

/**
 * The code that describes a failed request: the one from the API, or one derived from the HTTP status or the
 * kind of failure.
 *
 * @param {{name?: string, code?: string, status?: number}} error
 * @returns {string}
 */
export const codeFromError = (error) => {
  if (error.name === "AbortError") {
    return "STREAM_INTERRUPTED";
  }
  const byStatus = { 429: "RATE_LIMITED", 503: "SERVICE_UNAVAILABLE", 403: "FORBIDDEN" };
  return byStatus[error.status] ?? error.code ?? "CONNECTION";
};

/**
 * Link for a source of an answer, or null if there is nothing to open.
 *
 * @param {{type: string, id: number|string, url?: string|null}} source
 * @param {string} wwwroot Moodle base URL.
 * @param {number} courseId
 * @returns {string|null}
 */
export const sourceUrl = (source, wwwroot, courseId) => {
  const base = wwwroot.replace(/\/+$/, "");
  if (source.type === "moodle_activity") {
    return `${base}/mod/view.php?id=${encodeURIComponent(String(source.id))}`;
  }
  if (source.type === "moodle_gradebook") {
    return `${base}/grade/report/grader/index.php?id=${courseId}`;
  }
  // A document is not served by Moodle: the backend decides whether it has a link.
  return source.url ?? null;
};

/**
 * Turns an internal tool name into text for the "consulting" line.
 *
 * @param {string} name For example `get_assignment_submissions`.
 * @returns {string} `get assignment submissions`
 */
export const toolLabel = (name) => name.replace(/_/g, " ");

/**
 * Rebuilds a conversation from `GET /assistant/conversations/:id`.
 *
 * @param {{id: string, messages: Array<{role: string, content: string}>}} history
 * @returns {object}
 */
export const fromHistory = (history) => ({
  conversationId: history.id,
  messages: history.messages.map((message) => ({
    role: message.role === "user" ? "user" : "assistant",
    text: message.content,
    status: "done",
    tools: [],
    sources: [],
    incompleteData: false,
    generatedAt: message.createdAt ?? null,
    errorCode: null,
  })),
});
