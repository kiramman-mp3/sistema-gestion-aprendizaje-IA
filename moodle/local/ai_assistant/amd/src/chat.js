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
 * Chat with the assistant (RF-10 to RF-14): streamed answers, sources, data warnings and errors.
 *
 * The state and the rules live in `chat_model`; this module builds the page and talks to the backend. Answers
 * are shown as plain text, never as HTML.
 *
 * @module     local_ai_assistant/chat
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import Config from "core/config";
import { nameLookup } from "local_ai_assistant/analytics_model";
import { callBackend, getCourseStudents, streamBackend } from "local_ai_assistant/assistant";
import * as Model from "local_ai_assistant/chat_model";
import { createStrings, el, uniqueId } from "local_ai_assistant/ui";

const PLAIN_STRINGS = [
  "title", "intro", "messagelabel", "placeholder", "send", "stop", "new", "empty", "you", "assistant", "thinking",
  "incomplete", "sources", "source_gradebook", "source_document",
  "error_ratelimited", "error_unavailable", "error_forbidden", "error_interrupted", "error_notfound", "error_validation",
  "historyerror",
];

const PARAM_STRINGS = {
  consulting: null,
  consulted: null,
  source_activity: null,
  source_document_page: null,
  student: null,
  error_other: null,
  error_ratelimited_wait: null,
};

const { load: loadStrings, str } = createStrings("chat", PLAIN_STRINGS, PARAM_STRINGS);

const storageKey = (courseId) => `local_ai_assistant_chat_${courseId}`;

/** The conversation id survives a reload of the page, but only in this tab. */
const rememberConversation = (courseId, conversationId) => {
  try {
    if (conversationId) {
      sessionStorage.setItem(storageKey(courseId), conversationId);
    } else {
      sessionStorage.removeItem(storageKey(courseId));
    }
  } catch {
    // Storage can be blocked; the conversation still works.
  }
};

const recalledConversation = (courseId) => {
  try {
    return sessionStorage.getItem(storageKey(courseId));
  } catch {
    return null;
  }
};

/**
 * State and behaviour of the chat of one course.
 */
class Chat {
  /**
   * @param {HTMLElement} root Region where the chat is drawn.
   * @param {number} courseId
   */
  constructor(root, courseId) {
    this.root = root;
    this.courseId = courseId;
    this.conversation = Model.emptyConversation();
    this.busy = false;
    this.controller = null;
    this.names = null;
    this.namesRequest = null;
  }

  /**
   * The names of the students, taken from Moodle with the teacher's session (they never go through the backend).
   * They are asked once; if Moodle cannot answer, the next answer asks again.
   *
   * @returns {Promise<Map<number, string>|null>}
   */
  loadNames() {
    this.namesRequest ??= getCourseStudents(this.courseId)
      .then((students) => {
        this.names = nameLookup(students);
        return this.names;
      })
      .catch(() => {
        this.namesRequest = null;
        return null;
      });
    return this.namesRequest;
  }

  /** Loads the names when an answer mentions students, then draws again with them. */
  async showNamesFor(message) {
    if (message?.role === "assistant" && message.students?.length > 0 && !this.names) {
      await this.loadNames();
      this.drawMessages();
    }
  }

  /** Draws the chat and restores the conversation of this tab, if there is one. */
  async start() {
    this.render();
    const remembered = recalledConversation(this.courseId);
    if (!remembered) {
      return;
    }
    try {
      this.conversation = Model.fromHistory(await callBackend(this.courseId, `/assistant/conversations/${encodeURIComponent(remembered)}`));
      this.drawMessages();
    } catch {
      rememberConversation(this.courseId, null);
      this.notice.replaceChildren(el("div", { class: "alert alert-warning", role: "status" }, str("historyerror")));
    }
  }

  render() {
    const inputId = uniqueId("message");
    this.log = el("div", { class: "border rounded p-3 mb-3 overflow-auto", style: "max-height: 28rem", role: "log", "aria-live": "polite", "aria-relevant": "additions text" });
    this.notice = el("div");
    this.input = el("textarea", {
      id: inputId,
      class: "form-control",
      rows: 2,
      maxlength: Model.MAX_MESSAGE_LENGTH,
      placeholder: str("placeholder"),
      oninput: () => this.refresh(),
      onkeydown: (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          this.send();
        }
      },
    });
    this.sendButton = el("button", { type: "submit", class: "btn btn-primary" }, str("send"));
    this.stopButton = el("button", { type: "button", class: "btn btn-outline-secondary d-none", onclick: () => this.controller?.abort() }, str("stop"));
    this.newButton = el("button", { type: "button", class: "btn btn-outline-secondary ms-auto", onclick: () => this.reset() }, str("new"));

    this.root.classList.remove("d-none");
    this.root.replaceChildren(
      el("h3", { class: "h5" }, str("title")),
      el("p", { class: "text-muted" }, str("intro")),
      this.log,
      this.notice,
      el(
        "form",
        {
          onsubmit: (event) => {
            event.preventDefault();
            this.send();
          },
        },
        el("label", { class: "form-label", for: inputId }, str("messagelabel")),
        this.input,
        el("div", { class: "d-flex gap-2 mt-2" }, this.sendButton, this.stopButton, this.newButton),
      ),
    );
    this.drawMessages();
    this.refresh();
  }

  /** Enables or disables the controls from the current state. */
  refresh() {
    this.sendButton.disabled = this.busy || !Model.canSend(this.input.value);
    this.input.disabled = this.busy;
    this.stopButton.classList.toggle("d-none", !this.busy);
    this.newButton.disabled = this.busy;
  }

  // -------------------------------------------------------------------------------------------
  // Drawing the conversation
  // -------------------------------------------------------------------------------------------

  drawMessages() {
    if (this.conversation.messages.length === 0) {
      this.log.replaceChildren(el("p", { class: "text-muted mb-0" }, str("empty")));
      return;
    }
    this.log.replaceChildren(...this.conversation.messages.map((message) => this.messageBlock(message)));
    this.log.scrollTop = this.log.scrollHeight;
  }

  messageBlock(message) {
    const mine = message.role === "user";
    return el(
      "div",
      { class: `mb-3 ${mine ? "text-end" : ""}`, "data-role": message.role },
      el("div", { class: "small text-muted" }, str(mine ? "you" : "assistant")),
      el(
        "div",
        { class: `d-inline-block rounded p-2 text-start ${mine ? "bg-primary text-white" : "bg-light"}`, style: "white-space: pre-wrap; max-width: 100%" },
        this.messageText(message) || (message.status === "streaming" ? str("thinking") : ""),
      ),
      mine ? null : this.assistantExtras(message),
    );
  }

  /** The text of a message with the pseudonyms of the students replaced by their names. */
  messageText(message) {
    return Model.displayText(message, this.names, (id) => str("student", id));
  }

  /** Tools in use, warnings, errors, sources and the date of the consultation. */
  assistantExtras(message) {
    const extras = [];
    if (message.status === "streaming" && message.tools.length > 0) {
      extras.push(el("div", { class: "small text-muted", role: "status" }, str("consulting", message.tools.map(Model.toolLabel).join(", "))));
    }
    if (message.status === "error") {
      extras.push(this.errorAlert(message));
    }
    if (message.incompleteData) {
      extras.push(el("div", { class: "small text-warning-emphasis", role: "note" }, str("incomplete")));
    }
    if (message.sources.length > 0) {
      extras.push(
        el(
          "div",
          { class: "small mt-1" },
          el("span", { class: "text-muted me-1" }, `${str("sources")}:`),
          ...message.sources.map((source, i) => this.sourceItem(source, i)),
        ),
      );
    }
    if (message.generatedAt) {
      extras.push(el("div", { class: "small text-muted" }, str("consulted", new Date(message.generatedAt).toLocaleString())));
    }
    return el("div", {}, ...extras);
  }

  errorAlert(message) {
    const kind = Model.errorKind(message.errorCode);
    let text;
    if (kind === "other") {
      text = str("error_other", message.errorCode);
    } else if (kind === "ratelimited" && message.retryAfter) {
      text = str("error_ratelimited_wait", message.retryAfter);
    } else {
      text = str(`error_${kind}`);
    }
    const details = message.details?.length > 0 ? el("ul", { class: "mb-0" }, ...message.details.map((detail) => el("li", {}, detail))) : null;
    return el("div", { class: "alert alert-danger py-1 px-2 mt-1 mb-0 small", role: "alert" }, text, details);
  }

  sourceItem(source, index) {
    const label = this.sourceLabel(source);
    const url = Model.sourceUrl(source, Config.wwwroot, this.courseId);
    const content = url ? el("a", { href: url, target: "_blank", rel: "noopener" }, label) : label;
    return el("span", { class: "me-2" }, index > 0 ? "· " : "", content);
  }

  sourceLabel(source) {
    if (source.type === "moodle_activity") {
      return str("source_activity", source.id);
    }
    if (source.type === "moodle_gradebook") {
      return str("source_gradebook");
    }
    return source.page ? str("source_document_page", source.page) : str("source_document");
  }

  // -------------------------------------------------------------------------------------------
  // Talking to the backend
  // -------------------------------------------------------------------------------------------

  /** Sends the typed question and shows the answer as it arrives. */
  async send() {
    if (this.busy || !Model.canSend(this.input.value)) {
      return;
    }
    const text = this.input.value;
    const body = Model.toChatRequest(this.conversation, this.courseId, text);
    this.input.value = "";
    this.conversation = Model.startTurn(this.conversation, text);
    this.notice.replaceChildren();
    this.busy = true;
    this.controller = new AbortController();
    this.drawMessages();
    this.refresh();

    try {
      await streamBackend(this.courseId, "/assistant/chat", {
        json: body,
        signal: this.controller.signal,
        onEvent: (event) => {
          this.conversation = Model.applyEvent(this.conversation, event);
          this.drawMessages();
          if (event.event === "final") {
            this.showNamesFor(this.conversation.messages.at(-1));
          }
        },
      });
      this.conversation = Model.closeTurn(this.conversation);
    } catch (error) {
      // A stopped answer is not an error of the service: it is shown as interrupted.
      const code = Model.codeFromError(error);
      this.conversation = Model.failTurn(this.conversation, code, Model.errorExtras(error));
      if (Model.errorKind(code, error.status) === "notfound") {
        // The backend no longer has the conversation: the next message starts a new one, and the question
        // that was lost goes back to the box so it can be sent again.
        this.conversation = Model.forgetConversation(this.conversation);
        this.input.value = text;
      }
    } finally {
      this.busy = false;
      this.controller = null;
      rememberConversation(this.courseId, this.conversation.conversationId);
      this.drawMessages();
      this.refresh();
      this.input.focus();
    }
  }

  /** Starts a new conversation. */
  reset() {
    this.conversation = Model.emptyConversation();
    rememberConversation(this.courseId, null);
    this.notice.replaceChildren();
    this.drawMessages();
    this.input.focus();
  }
}

/**
 * Entry point called from index.php.
 *
 * @param {number} courseId
 * @returns {Promise<void>}
 */
export const init = async (courseId) => {
  const root = document.querySelector('[data-region="local_ai_assistant"] [data-region="chat"]');
  if (!root) {
    return;
  }
  await loadStrings();
  await new Chat(root, courseId).start();
};
