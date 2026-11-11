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
 * Publication of an approved proposal to Moodle (RF-09): explicit confirmation, progress, a summary with
 * links to what was created, and resuming after a failure.
 *
 * The backend publishes in the background, one element at a time, and can resume without duplicating
 * anything. This panel only starts it, follows it and shows the result.
 *
 * @module     local_ai_assistant/publish_panel
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import Config from "core/config";
import { callBackend } from "local_ai_assistant/assistant";
import * as Model from "local_ai_assistant/proposal_model";
import { createStrings, el, uniqueId } from "local_ai_assistant/ui";

const POLL_TIMEOUT_MS = 10 * 60 * 1000;

/** Tunable so tests do not wait for real time. */
export const settings = { pollIntervalMs: 1500 };

const PLAIN_STRINGS = [
  "title", "intro", "confirm", "unsaved", "publish", "resume", "starting", "running",
  "summary_heading", "hiddennote", "open", "failed_heading", "failed_resume",
  "reason_moodle_permission", "reason_moodle_unavailable", "reason_moodle_bad_response", "reason_publish_error",
  "kind_section", "kind_assign", "kind_forum", "kind_quiz", "kind_label", "kind_page",
];

const PARAM_STRINGS = {
  progress: ["created", "total"],
  success: null,
  failed_summary: ["created", "total"],
  failed_item: ["title", "reason"],
  reason_moodle_error: null,
  starterror: null,
  followerror: null,
};

const { load: loadStrings, str } = createStrings("publish", PLAIN_STRINGS, PARAM_STRINGS);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Loads the strings of the panel. Call it once before creating a panel.
 *
 * @returns {Promise<void>}
 */
export const loadPanelStrings = loadStrings;

/**
 * The publication part of the proposal preview.
 */
export class PublishPanel {
  /**
   * @param {{courseId: number, isDirty: function(): boolean, onFinished: function(): Promise<void>}} options
   *     `isDirty` tells whether the teacher has unsaved edits; `onFinished` reloads the proposal when a
   *     publication ends.
   */
  constructor({ courseId, isDirty, onFinished }) {
    this.courseId = courseId;
    this.isDirty = isDirty;
    this.onFinished = onFinished;
    this.container = null;
    this.proposal = null;
    this.operation = null;
    this.confirmed = false;
    this.busy = false;
    this.key = null;
    this.following = null;
    this.message = null;
  }

  /**
   * Sets the element the panel draws into. The preview draws again from scratch, so it calls this each time.
   *
   * @param {HTMLElement} container
   */
  attach(container) {
    this.container = container;
  }

  /**
   * Shows the panel for a proposal, and follows its publication if one is running.
   *
   * @param {object} proposal The proposal as the backend returned it.
   */
  update(proposal) {
    this.proposal = proposal;
    if (proposal.status !== "APPROVED") {
      this.confirmed = false;
    }
    this.render();
    if (proposal.status === "PUBLISHING" && proposal.lastPublishOperation && !this.following) {
      this.follow(proposal.lastPublishOperation.id);
    }
  }

  /** Draws the panel for the current state. */
  render() {
    if (!this.container || !this.proposal) {
      return;
    }
    const phase = Model.publishPhase(this.proposal);
    const parts = {
      none: () => [],
      ready: () => this.ready(),
      running: () => this.running(),
      failed: () => this.failed(),
      done: () => this.done(),
    }[phase]();
    this.container.replaceChildren(...parts.filter(Boolean));
  }

  // -------------------------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------------------------

  heading(text) {
    return el("h4", { class: "h6 lai-subheading" }, text);
  }

  alert(type, ...content) {
    return el("div", { class: `alert alert-${type} mb-2`, role: type === "danger" ? "alert" : "status" }, ...content);
  }

  /** The proposal is approved: ask for confirmation and offer to publish. */
  ready() {
    const dirty = this.isDirty();
    const confirmId = uniqueId("confirm");
    const enabled = Model.canPublish(this.proposal, { confirmed: this.confirmed, dirty, busy: this.busy });
    return [
      this.heading(str("title")),
      el("p", { class: "text-muted" }, str("intro")),
      dirty ? this.alert("warning", str("unsaved")) : null,
      el(
        "div",
        { class: "form-check mb-3" },
        el("input", {
          id: confirmId,
          type: "checkbox",
          class: "form-check-input",
          checked: this.confirmed,
          disabled: dirty || this.busy,
          onchange: (event) => {
            this.confirmed = event.target.checked;
            this.render();
          },
        }),
        el("label", { class: "form-check-label", for: confirmId }, str("confirm")),
      ),
      el("button", { type: "button", class: "btn btn-primary", disabled: !enabled, onclick: () => this.start() }, str("publish")),
      this.busy ? el("p", { class: "mt-2", role: "status" }, str("starting")) : null,
      this.message,
    ];
  }

  /** A publication is running: show its progress. */
  running() {
    const progress = this.operation ? Model.progressOf(this.operation) : { created: 0, total: this.proposal.items.length, percent: 0 };
    const label = str("progress", { created: progress.created, total: progress.total });
    return [
      this.heading(str("title")),
      el("p", { class: "text-muted" }, str("running")),
      el(
        "div",
        { class: "progress mb-2" },
        el("div", {
          class: "progress-bar",
          role: "progressbar",
          style: `width: ${progress.percent}%`,
          "aria-valuenow": progress.percent,
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-label": label,
        }),
      ),
      el("p", { role: "status" }, label),
      this.message,
    ];
  }

  /** The publication stopped: show what happened and offer to resume. */
  failed() {
    const failures = Model.failedItems(this.proposal.items);
    const created = Model.createdItems(this.proposal.items, Config.wwwroot, this.courseId).length;
    const total = this.proposal.items.length;
    const dirty = this.isDirty();
    return [
      this.heading(str("failed_heading")),
      this.alert(
        "danger",
        el("p", { class: "mb-1" }, str("failed_summary", { created, total })),
        el("ul", { class: "mb-0" }, failures.map((failure) => el("li", {}, str("failed_item", { title: failure.title || "—", reason: this.reason(failure.error) })))),
      ),
      el("p", { class: "text-muted" }, str("failed_resume")),
      dirty ? this.alert("warning", str("unsaved")) : null,
      el("button", { type: "button", class: "btn btn-primary", disabled: this.busy || dirty, onclick: () => this.start() }, str("resume")),
      this.message,
    ];
  }

  /** The proposal is published: summarize what was created, with links. */
  done() {
    const created = Model.createdItems(this.proposal.items, Config.wwwroot, this.courseId);
    return [
      this.heading(str("summary_heading")),
      this.alert("success", str("success", created.length)),
      el("p", { class: "text-muted" }, str("hiddennote")),
      el(
        "ul",
        { class: "list-unstyled" },
        created.map((item) =>
          el(
            "li",
            { class: item.parentId ? "ms-4 mb-1" : "mt-2 mb-1 fw-bold" },
            el("span", { class: "badge lai-secondary me-2" }, str(`kind_${item.itemType.toLowerCase()}`)),
            `${item.title || "—"} `,
            el("a", { href: item.url, target: "_blank", rel: "noopener" }, str("open")),
          ),
        ),
      ),
    ];
  }

  /** The text for a failure code from the backend. */
  reason(code) {
    const { key, detail } = Model.describeFailureCode(code);
    return key === "moodle_error" ? str("reason_moodle_error", detail) : str(`reason_${key}`);
  }

  // -------------------------------------------------------------------------------------------
  // Publishing
  // -------------------------------------------------------------------------------------------

  /**
   * Starts the publication, or resumes a failed one. The key is created once per attempt: if the answer
   * is lost and the teacher presses the button again, the backend recognizes the attempt.
   */
  async start() {
    const proposal = this.proposal;
    if (!Model.canPublish(proposal, { confirmed: this.confirmed, dirty: this.isDirty(), busy: this.busy })) {
      return;
    }
    this.busy = true;
    this.message = null;
    this.key ??= Model.newIdempotencyKey();
    this.render();
    try {
      const operation = await callBackend(this.courseId, `/proposals/${encodeURIComponent(proposal.id)}/publish`, {
        method: "POST",
        json: { confirm: true },
        headers: { "Idempotency-Key": this.key },
      });
      this.key = null;
      this.operation = operation;
      this.busy = false;
      this.proposal = { ...proposal, status: "PUBLISHING", lastPublishOperation: { id: operation.id, status: operation.status } };
      this.render();
      await this.follow(operation.id);
    } catch (error) {
      this.busy = false;
      this.message = this.alert("danger", str("starterror", error.code || error.message));
      this.render();
    }
  }

  /**
   * Polls the operation until it ends, then asks the preview to reload the proposal.
   *
   * @param {string} operationId
   */
  async follow(operationId) {
    this.following = operationId;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    try {
      while (Date.now() < deadline) {
        this.operation = await callBackend(
          this.courseId,
          `/proposals/${encodeURIComponent(this.proposal.id)}/publish-operations/${encodeURIComponent(operationId)}`,
        );
        this.render();
        if (this.operation.status !== "RUNNING") {
          break;
        }
        await wait(settings.pollIntervalMs);
      }
    } catch (error) {
      this.following = null;
      this.message = this.alert("danger", str("followerror", error.code || error.message));
      this.render();
      return;
    }
    this.following = null;
    await this.onFinished();
  }
}
