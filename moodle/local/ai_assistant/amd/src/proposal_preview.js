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
 * Editable preview of the course proposal (RF-08): the sections and activities the assistant would
 * create in Moodle, which the teacher reviews, edits, saves and approves.
 *
 * The rules (tree, edits, validation) live in `proposal_model`; this module builds the page and talks to
 * the backend. Review findings come from the backend and describe the last saved version.
 *
 * @module     local_ai_assistant/proposal_preview
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import { callBackend } from "local_ai_assistant/assistant";
import * as Model from "local_ai_assistant/proposal_model";
import { loadPanelStrings, PublishPanel } from "local_ai_assistant/publish_panel";
import { createStrings, el, uniqueId } from "local_ai_assistant/ui";

const PLAIN_STRINGS = [
  "title", "intro", "loading", "generating", "notreviewed", "exists", "openexisting", "createanother",
  "status_draft", "status_needs_review", "status_approved", "status_publishing", "status_published",
  "status_rejected", "status_failed", "readonly",
  "summary_clear", "summary_unsaved", "issues_heading", "untitled",
  "field_title", "field_description", "field_type", "field_due", "field_weight", "field_outcomes",
  "nooutcomes", "itemtype_assign", "itemtype_forum", "itemtype_quiz", "itemtype_label", "itemtype_page",
  "add_section", "add_activity", "save", "saving", "saved", "approve", "approving", "approvehint",
  "approveandpublish", "approveandpublishconfirm", "approveandpublishhint",
  "error_weight", "error_date", "error_toolong", "severity_error", "severity_warning",
];

const PARAM_STRINGS = {
  loaderror: null,
  createerror: null,
  saveerror: null,
  approveerror: null,
  basedon: null,
  approvedinfo: ["user", "date"],
  summary_errors: null,
  summary_warnings: null,
  sectionn: null,
  activityn: null,
  remove: null,
  moveup: null,
  movedown: null,
};

const { load: loadStrings, str } = createStrings("proposal", PLAIN_STRINGS, PARAM_STRINGS);

const STATUS_CLASS = {
  DRAFT: "lai-secondary",
  NEEDS_REVIEW: "lai-warning",
  APPROVED: "lai-success",
  PUBLISHING: "lai-info",
  PUBLISHED: "lai-success",
  REJECTED: "lai-danger",
  FAILED: "lai-danger",
};

/**
 * State and behaviour of one mounted proposal.
 */
class Preview {
  /**
   * @param {HTMLElement} root Region where the preview is drawn.
   * @param {number} courseId
   */
  constructor(root, courseId) {
    this.root = root;
    this.courseId = courseId;
    this.proposal = null;
    this.items = [];
    this.knownOutcomes = [];
    this.dirty = false;
    this.busy = false;
    /** The teacher ticked the confirmation that goes with "Approve and publish". */
    this.confirmPublish = false;
    this.collapsed = new Set();
    this.updaters = [];
    this.publishPanel = new PublishPanel({
      courseId,
      isDirty: () => this.dirty,
      onFinished: () => this.open(this.proposal.id),
    });
    window.addEventListener("beforeunload", (event) => {
      if (this.dirty) {
        event.preventDefault();
      }
    });
  }

  show(...nodes) {
    this.root.classList.remove("d-none");
    this.root.replaceChildren(...nodes.filter(Boolean));
  }

  alert(type, ...content) {
    return el("div", { class: `alert alert-${type} mb-2`, role: type === "danger" ? "alert" : "status" }, ...content);
  }

  spinner(text) {
    return el("div", { role: "status" }, el("span", { class: "spinner-border spinner-border-sm me-2", "aria-hidden": "true" }), text);
  }

  // -------------------------------------------------------------------------------------------
  // Loading and creating
  // -------------------------------------------------------------------------------------------

  /** Loads a proposal and draws it. */
  async open(proposalId) {
    this.show(this.spinner(str("loading")));
    try {
      this.setProposal(await callBackend(this.courseId, `/proposals/${encodeURIComponent(proposalId)}`));
      this.knownOutcomes = await this.loadOutcomes();
    } catch (error) {
      this.show(this.alert("danger", str("loaderror", error.code || error.message)));
      return;
    }
    this.render();
  }

  /**
   * Generates a proposal from a saved extraction version and opens it. If the syllabus already has one, it
   * asks whether to open it or create another.
   */
  async generate(syllabusId, extractionVersion, confirmDuplicate = false) {
    this.show(this.spinner(str("generating")));
    try {
      const body = { syllabusId, extractionVersion, ...(confirmDuplicate ? { confirmDuplicate: true } : {}) };
      const proposal = await callBackend(this.courseId, "/proposals", { method: "POST", json: body });
      this.setProposal(proposal);
      this.knownOutcomes = await this.loadOutcomes();
      this.render();
    } catch (error) {
      if (error.code === "PROPOSAL_EXISTS") {
        this.showExisting(syllabusId, extractionVersion, error.details?.[0]?.message);
      } else if (error.code === "EXTRACTION_NOT_REVIEWED") {
        this.show(this.alert("warning", str("notreviewed")));
      } else {
        this.show(this.alert("danger", str("createerror", error.code || error.message)));
      }
    }
  }

  showExisting(syllabusId, extractionVersion, existingId) {
    this.show(
      this.alert(
        "warning",
        el("p", {}, str("exists")),
        el(
          "div",
          { class: "d-flex gap-2" },
          existingId && el("button", { type: "button", class: "btn btn-primary", onclick: () => this.open(existingId) }, str("openexisting")),
          el("button", { type: "button", class: "btn btn-outline-secondary", onclick: () => this.generate(syllabusId, extractionVersion, true) }, str("createanother")),
        ),
      ),
    );
  }

  setProposal(proposal) {
    this.proposal = proposal;
    this.items = structuredClone(proposal.items);
    this.dirty = false;
  }

  /** Outcome ids defined in the extraction; if it cannot be read, the ones already in use are enough. */
  async loadOutcomes() {
    try {
      const extraction = await callBackend(
        this.courseId,
        `/syllabi/${encodeURIComponent(this.proposal.syllabusId)}/extraction?version=${this.proposal.extractionVersion}`,
      );
      return extraction.content.learningOutcomes.map((outcome) => outcome.id);
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------------------------
  // Changes
  // -------------------------------------------------------------------------------------------

  /**
   * Applies new items. Field edits only refresh the indicators so the cursor stays; structural edits
   * redraw the tree.
   */
  change(items, { redraw = false, focus = null } = {}) {
    this.items = items;
    this.dirty = true;
    this.status.replaceChildren();
    if (redraw) {
      this.render(focus);
    } else {
      this.refresh();
    }
  }

  edit(id, changes) {
    this.change(Model.updateItem(this.items, id, changes));
  }

  // -------------------------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------------------------

  render(focusId = null) {
    this.updaters = [];
    this.summary = el("div", { class: "mb-3", "aria-live": "polite" });
    this.general = el("div", { class: "mb-3" });
    this.status = el("div", { class: "mt-3", "aria-live": "polite" });
    this.publishBox = el("div");
    this.saveButton = el("button", { type: "button", class: "btn btn-primary", onclick: () => this.save() }, str("save"));
    this.approveButton = el("button", { type: "button", class: "btn btn-outline-success", onclick: () => this.approve() }, str("approve"));
    this.approveHint = el("span", { class: "small text-muted align-self-center" });
    // One decision to approve and publish: the confirmation is explicit and stays, but it is asked once.
    const confirmId = uniqueId("approvepublish");
    this.confirmBox = el("input", {
      id: confirmId,
      type: "checkbox",
      class: "form-check-input",
      checked: this.confirmPublish,
      onchange: (event) => {
        this.confirmPublish = event.target.checked;
        this.refresh();
      },
    });
    this.approvePublishButton = el("button", { type: "button", class: "btn btn-success", onclick: () => this.approveAndPublish() }, str("approveandpublish"));
    this.approvePublishBlock = el(
      "div",
      { class: "border rounded p-3 mb-3" },
      el("p", { class: "small text-muted mb-2" }, str("approveandpublishhint")),
      el("div", { class: "form-check mb-2" }, this.confirmBox, el("label", { class: "form-check-label", for: confirmId }, str("approveandpublishconfirm"))),
      this.approvePublishButton,
    );

    const sections = Model.sectionsOf(this.items);
    this.show(
      el(
        "div",
        { class: "d-flex align-items-center gap-2 mb-1" },
        el("h3", { class: "h5 mb-0" }, str("title")),
        el("span", { class: `badge ${STATUS_CLASS[this.proposal.status] ?? "lai-secondary"}` }, str(`status_${this.proposal.status.toLowerCase()}`)),
      ),
      el("p", { class: "small text-muted mb-2" }, str("basedon", this.proposal.extractionVersion)),
      el("p", { class: "text-muted" }, str("intro")),
      this.approvalInfo(),
      this.summary,
      this.general,
      el("div", {}, ...sections.map((section, i) => this.sectionBlock(section, i))),
      el("div", { class: "mb-3" }, this.addButton(str("add_section"), () => {
        const next = Model.addSection(this.items);
        this.change(next, { redraw: true, focus: next.at(-1).id });
      })),
      // Only while the proposal waits for review: afterwards the publication panel asks for its own confirmation.
      this.proposal.status === "NEEDS_REVIEW" ? this.approvePublishBlock : null,
      el("div", { class: "d-flex gap-2 flex-wrap" }, this.saveButton, this.approveButton, this.approveHint),
      this.status,
      this.publishBox,
    );
    this.publishPanel.attach(this.publishBox);
    this.publishPanel.update(this.proposal);
    this.refresh();
    if (focusId) {
      this.root.querySelector(`[data-item="${focusId}"]`)?.focus();
    }
  }

  approvalInfo() {
    if (this.proposal.status === "APPROVED" && this.proposal.approvedAt) {
      return this.alert("success", str("approvedinfo", { user: this.proposal.approvedBy, date: new Date(this.proposal.approvedAt).toLocaleString() }));
    }
    if (!Model.EDITABLE_STATUSES.includes(this.proposal.status)) {
      return this.alert("secondary", str("readonly"));
    }
    return null;
  }

  /** Redraws the summary, the buttons and every field error from the current state. */
  refresh() {
    const actions = Model.availableActions(this.proposal, this.dirty, this.items);
    const errors = this.proposal.issues.filter((issue) => issue.severity === "error").length;
    const warnings = this.proposal.issues.length - errors;
    const badges = [];
    if (errors) {
      badges.push(el("span", { class: "badge lai-danger me-2" }, str("summary_errors", errors)));
    }
    if (warnings) {
      badges.push(el("span", { class: "badge lai-warning me-2" }, str("summary_warnings", warnings)));
    }
    this.summary.replaceChildren(
      ...(badges.length ? badges : [el("span", { class: "badge lai-success" }, str("summary_clear"))]),
      ...(this.dirty ? [el("span", { class: "small text-muted" }, str("summary_unsaved"))] : []),
    );

    this.general.replaceChildren(
      ...(Model.generalIssues(this.proposal.issues).length
        ? [
            el(
              "div",
              { class: "alert alert-warning mb-0", role: "region", "aria-label": str("issues_heading") },
              el("h4", { class: "h6" }, str("issues_heading")),
              el("ul", { class: "mb-0" }, Model.generalIssues(this.proposal.issues).map((issue) => this.issueLine(issue))),
            ),
          ]
        : []),
    );

    this.saveButton.disabled = this.busy || !actions.canSave;
    this.saveButton.classList.toggle("d-none", !actions.canEdit);
    this.approveButton.disabled = this.busy || !actions.canApprove;
    this.approveButton.classList.toggle("d-none", this.proposal.status !== "NEEDS_REVIEW");
    this.approveHint.textContent = actions.canApprove || this.proposal.status !== "NEEDS_REVIEW" ? "" : str("approvehint");
    this.confirmBox.disabled = this.busy;
    this.approvePublishButton.disabled = this.busy || !actions.canApprove || !this.confirmPublish;

    const fieldErrors = Model.findFieldErrors(this.items);
    for (const update of this.updaters) {
      update(fieldErrors);
    }
    // The publication panel depends on whether there are unsaved edits.
    this.publishPanel.render();
  }

  issueLine(issue) {
    return el(
      "li",
      {},
      el("span", { class: `badge ${issue.severity === "error" ? "lai-danger" : "lai-warning"} me-1` }, str(`severity_${issue.severity}`)),
      issue.message,
    );
  }

  addButton(label, onclick) {
    return el("button", { type: "button", class: "btn btn-sm btn-outline-primary", onclick }, label);
  }

  /** A block for a section with its activities. */
  sectionBlock(section, index) {
    const label = str("sectionn", index + 1);
    const activities = Model.activitiesOf(this.items, section.id);
    return el(
      "details",
      {
        class: "card card-body mb-3",
        open: !this.collapsed.has(section.id),
        ontoggle: (event) => this.remember(section.id, event.target.open),
      },
      el("summary", { class: "fw-bold mb-2" }, `${label}: ${section.title || str("untitled")}`),
      this.itemControls(section, label),
      this.titleField(section),
      this.textareaField(section, "description", str("field_description")),
      this.outcomeLinks(section),
      this.itemIssues(section),
      el("div", { class: "ms-md-3" }, ...activities.map((activity, i) => this.activityBlock(activity, i))),
      el("div", {}, this.addButton(str("add_activity"), () => {
        const next = Model.addActivity(this.items, section.id);
        const created = next.find((item) => !this.items.some((existing) => existing.id === item.id));
        this.change(next, { redraw: true, focus: created.id });
      })),
    );
  }

  activityBlock(activity, index) {
    const label = str("activityn", index + 1);
    return el(
      "div",
      { class: "border rounded p-3 mb-3" },
      el("div", { class: "fw-bold mb-2" }, `${label}: ${activity.title || str("untitled")}`),
      this.itemControls(activity, label),
      this.titleField(activity),
      this.typeField(activity),
      this.textareaField(activity, "description", str("field_description")),
      this.dateField(activity),
      this.weightField(activity),
      this.outcomeLinks(activity),
      this.itemIssues(activity),
    );
  }

  remember(key, open) {
    if (open) {
      this.collapsed.delete(key);
    } else {
      this.collapsed.add(key);
    }
  }

  /** Move up, move down and remove buttons of an item. */
  itemControls(item, label) {
    if (!Model.availableActions(this.proposal, this.dirty, this.items).canEdit) {
      return null;
    }
    const move = (direction, text) =>
      el(
        "button",
        {
          type: "button",
          class: "btn btn-sm btn-outline-secondary",
          disabled: !Model.canMove(this.items, item.id, direction),
          "aria-label": str(direction < 0 ? "moveup" : "movedown", label),
          title: str(direction < 0 ? "moveup" : "movedown", label),
          onclick: () => this.change(Model.moveItem(this.items, item.id, direction), { redraw: true, focus: item.id }),
        },
        text,
      );
    return el(
      "div",
      { class: "d-flex gap-2 mb-2" },
      move(-1, "↑"),
      move(1, "↓"),
      el("button", { type: "button", class: "btn btn-sm btn-outline-danger", onclick: () => this.change(Model.removeItem(this.items, item.id), { redraw: true }) }, str("remove", label)),
    );
  }

  /** Review findings the backend reported for one item. */
  itemIssues(item) {
    const found = Model.issuesForItem(this.proposal.issues, item.id);
    return found.length ? el("ul", { class: "small mb-2" }, found.map((issue) => this.issueLine(issue))) : null;
  }

  /**
   * Wraps a control with its label and an error area that is refreshed with the rest.
   *
   * @param {object} item
   * @param {string} field `title`, `dueDate` or `weight`, to look up errors.
   * @param {string} label
   * @param {function(string, string): HTMLElement} makeControl Receives the control id and the error id.
   */
  field(item, field, label, makeControl) {
    const id = uniqueId("field");
    const errorId = `${id}-error`;
    const control = makeControl(id, errorId);
    if (field === "title") {
      control.dataset.item = item.id;
    }
    const error = el("div", { id: errorId, class: "small text-danger" });
    this.updaters.push((errors) => {
      const found = errors.find((candidate) => candidate.id === item.id && candidate.field === field);
      control.classList.toggle("is-invalid", Boolean(found));
      control.setAttribute("aria-invalid", found ? "true" : "false");
      error.textContent = found ? str(`error_${found.code}`) : "";
    });
    return el("div", { class: "mb-3" }, el("label", { class: "form-label", for: id }, label), control, error);
  }

  /** Disables editing controls when the proposal can no longer be edited. */
  editable() {
    return Model.availableActions(this.proposal, this.dirty, this.items).canEdit;
  }

  titleField(item) {
    return this.field(item, "title", str("field_title"), (id, errorId) =>
      el("input", {
        id,
        type: "text",
        class: "form-control",
        value: item.title,
        disabled: !this.editable(),
        "aria-describedby": errorId,
        oninput: (event) => this.edit(item.id, { title: event.target.value }),
      }),
    );
  }

  textareaField(item, property, label) {
    const id = uniqueId("field");
    return el(
      "div",
      { class: "mb-3" },
      el("label", { class: "form-label", for: id }, label),
      el("textarea", {
        id,
        class: "form-control",
        rows: 2,
        disabled: !this.editable(),
        oninput: (event) => this.edit(item.id, { [property]: event.target.value.trim() === "" ? null : event.target.value }),
      }, item[property] ?? ""),
    );
  }

  typeField(item) {
    const id = uniqueId("field");
    return el(
      "div",
      { class: "mb-3" },
      el("label", { class: "form-label", for: id }, str("field_type")),
      el(
        "select",
        { id, class: "form-select", disabled: !this.editable(), onchange: (event) => this.edit(item.id, { itemType: event.target.value }) },
        Model.ACTIVITY_ITEM_TYPES.map((type) => el("option", { value: type, selected: item.itemType === type }, str(`itemtype_${type.toLowerCase()}`))),
      ),
    );
  }

  dateField(item) {
    return this.field(item, "dueDate", str("field_due"), (id, errorId) =>
      el("input", {
        id,
        type: "date",
        class: "form-control",
        value: item.dueDate ?? "",
        disabled: !this.editable(),
        "aria-describedby": errorId,
        oninput: (event) => this.edit(item.id, { dueDate: event.target.validity.badInput ? "invalid" : event.target.value || null }),
      }),
    );
  }

  weightField(item) {
    return this.field(item, "weight", str("field_weight"), (id, errorId) =>
      el("input", {
        id,
        type: "number",
        min: 0,
        max: 100,
        step: "any",
        class: "form-control",
        value: item.weight ?? "",
        disabled: !this.editable(),
        "aria-describedby": errorId,
        oninput: (event) => {
          const text = event.target.value.trim().replace(",", ".");
          this.edit(item.id, { weight: event.target.validity.badInput ? Number.NaN : text === "" ? null : Number(text) });
        },
      }),
    );
  }

  /** Check boxes for the learning outcomes of an item. */
  outcomeLinks(item) {
    const options = Model.outcomeOptions(this.items, this.knownOutcomes);
    const boxes = options.length
      ? options.map((outcome) => {
          const id = uniqueId("outcome");
          return el(
            "div",
            { class: "form-check form-check-inline" },
            el("input", {
              id,
              type: "checkbox",
              class: "form-check-input",
              checked: item.learningOutcomeIds.includes(outcome),
              disabled: !this.editable(),
              onchange: (event) => {
                const current = this.items.find((candidate) => candidate.id === item.id).learningOutcomeIds;
                this.edit(item.id, {
                  learningOutcomeIds: event.target.checked ? [...new Set([...current, outcome])] : current.filter((value) => value !== outcome),
                });
              },
            }),
            el("label", { class: "form-check-label", for: id }, outcome),
          );
        })
      : [el("span", { class: "small text-muted" }, str("nooutcomes"))];
    return el("fieldset", { class: "mb-3" }, el("legend", { class: "form-label fs-6" }, str("field_outcomes")), el("div", {}, boxes));
  }

  // -------------------------------------------------------------------------------------------
  // Saving and approving
  // -------------------------------------------------------------------------------------------

  /** Runs a backend call with the buttons locked and shows its outcome. */
  async run(workingText, call, errorString, successText) {
    this.busy = true;
    this.refresh();
    this.status.replaceChildren(this.spinner(workingText));
    try {
      this.setProposal(await call());
      this.busy = false;
      this.render();
      if (successText) {
        this.status.replaceChildren(this.alert("success", successText));
      }
    } catch (error) {
      this.busy = false;
      this.refresh();
      this.status.replaceChildren(this.alert("danger", str(errorString, error.code || error.message)));
    }
  }

  save() {
    if (!Model.availableActions(this.proposal, this.dirty, this.items).canSave) {
      return Promise.resolve();
    }
    return this.run(
      str("saving"),
      () => callBackend(this.courseId, `/proposals/${encodeURIComponent(this.proposal.id)}`, { method: "PATCH", json: Model.toPatchBody(this.items) }),
      "saveerror",
      str("saved"),
    );
  }

  approve() {
    if (!Model.availableActions(this.proposal, this.dirty, this.items).canApprove) {
      return Promise.resolve();
    }
    return this.run(
      str("approving"),
      () => callBackend(this.courseId, `/proposals/${encodeURIComponent(this.proposal.id)}/approve`, { method: "POST" }),
      "approveerror",
      null,
    );
  }

  /**
   * Approves and publishes with a single confirmation. Approval is still a step of its own on the backend (who
   * approved and when is recorded) and publication still needs `confirm: true`; here both are asked together.
   * If the approval fails its error is on screen and nothing is published.
   */
  async approveAndPublish() {
    if (this.busy || !this.confirmPublish || !Model.availableActions(this.proposal, this.dirty, this.items).canApprove) {
      return;
    }
    await this.approve();
    if (this.proposal.status !== "APPROVED") {
      return;
    }
    this.publishPanel.confirmed = true;
    await this.publishPanel.start();
  }
}

const regionRoot = () => document.querySelector('[data-region="local_ai_assistant"] [data-region="proposal-preview"]');

/**
 * Opens an existing proposal.
 *
 * @param {number} courseId
 * @param {string} proposalId
 * @returns {Promise<void>}
 */
export const open = async (courseId, proposalId) => {
  const root = regionRoot();
  if (!root) {
    return;
  }
  await Promise.all([loadStrings(), loadPanelStrings()]);
  await new Preview(root, courseId).open(proposalId);
};

/**
 * Generates a proposal from a saved extraction version and opens it.
 *
 * @param {number} courseId
 * @param {string} syllabusId
 * @param {number} extractionVersion
 * @returns {Promise<void>}
 */
export const generate = async (courseId, syllabusId, extractionVersion) => {
  const root = regionRoot();
  if (!root) {
    return;
  }
  await Promise.all([loadStrings(), loadPanelStrings()]);
  await new Preview(root, courseId).generate(syllabusId, extractionVersion);
};

/**
 * Entry point called from index.php: resumes the proposal of the `proposalid` URL parameter or, without one, the
 * most recent proposal of the course, so the teacher finds it where they left it. A course with no proposal
 * (404) shows nothing.
 *
 * @param {number} courseId
 * @param {string} [proposalId]
 */
export const init = async (courseId, proposalId = "") => {
  if (proposalId) {
    open(courseId, proposalId);
    return;
  }
  let latest;
  try {
    latest = await callBackend(courseId, "/proposals/latest");
  } catch {
    // No proposal yet, or the backend is not reachable: the connection card already says so.
    return;
  }
  if (latest?.id) {
    open(courseId, latest.id);
  }
};
