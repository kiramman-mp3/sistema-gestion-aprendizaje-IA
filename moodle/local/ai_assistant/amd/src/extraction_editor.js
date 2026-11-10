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
 * Editor of the structure extracted from a syllabus (RF-06).
 *
 * The teacher reviews and corrects the units, topics, learning outcomes, dates and weights that the
 * assistant proposes. Fields the assistant was unsure about show a confidence indicator. Saving
 * creates a new version of the extraction in the backend.
 *
 * The editing rules live in `extraction_model`; this module only builds the page and wires events.
 *
 * @module     local_ai_assistant/extraction_editor
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import { callBackend } from "local_ai_assistant/assistant";
import * as Model from "local_ai_assistant/extraction_model";
import { generate as generateProposal } from "local_ai_assistant/proposal_preview";
import { createStrings, el, uniqueId } from "local_ai_assistant/ui";

/** Strings without parameters. The key is `extraction_<name>`; the map is read as `t.<name>`. */
const PLAIN_STRINGS = [
  "title", "intro", "loading", "summary_clear", "save", "saving", "fixerrors",
  "issues_heading", "issues_note", "markreviewed", "source_nopage",
  "section_course", "section_outcomes", "section_periods", "section_methodologies", "section_resources",
  "section_instruments", "section_bibliography",
  "field_coursename", "field_coursecode", "field_period", "field_teacher", "field_objective",
  "field_outcomeid", "field_outcomedesc", "field_periodname", "field_weight", "field_unittitle",
  "field_topics", "field_topic", "field_startdate", "field_enddate", "field_outcomes",
  "field_activitytitle", "field_activitytype", "field_description", "field_due", "field_requiresreview",
  "field_instrument", "field_item", "nooutcomes", "untitled", "source_ai", "source_teacher",
  "add_outcome", "add_period", "add_unit", "add_activity", "add_topic", "add_item", "add_instrument", "generateproposal",
  "reason_missing", "reason_ambiguous", "reason_low_confidence", "reason_inconsistent",
  "error_required", "error_weight", "error_date", "error_outcomeid",
  ...Model.ACTIVITY_TYPES.map((type) => `acttype_${type}`),
];

/**
 * Strings with parameters. `null` means a single `{$a}`; a list names the properties of `{$a->name}`.
 * They are requested once with markers (`{name}`) and filled in later, so rendering stays synchronous.
 */
const PARAM_STRINGS = {
  loaderror: null,
  saved: null,
  saveerror: null,
  summary_uncertain: null,
  summary_issues: null,
  summary_errors: null,
  version: ["version", "source"],
  periodn: null,
  unitn: null,
  activityn: null,
  outcomen: null,
  remove: null,
  unknownoutcome: null,
  source_page: null,
  issue_duplicate_learning_outcome_id: ["id"],
  issue_unknown_learning_outcome: ["id"],
  issue_activity_without_learning_outcome: ["title"],
  issue_grading_period_weights_not_100: ["total"],
  issue_activity_weights_exceed_100: ["name", "total"],
  issue_unit_dates_reversed: ["title"],
  issue_due_date_outside_unit: ["title"],
};

/** Lists of plain text the editor shows after the course data. */
const TEXT_LISTS = [
  ["methodologies", "section_methodologies"],
  ["resources", "section_resources"],
  ["bibliography", "section_bibliography"],
];

const { load: loadStrings, str } = createStrings("extraction", PLAIN_STRINGS, PARAM_STRINGS);

/**
 * Editor state and behaviour for one mounted syllabus.
 */
class Editor {
  /**
   * @param {HTMLElement} root Region where the editor is drawn.
   * @param {number} courseId
   * @param {string} syllabusId
   */
  constructor(root, courseId, syllabusId) {
    this.root = root;
    this.courseId = courseId;
    this.syllabusId = syllabusId;
    this.extraction = null;
    this.version = null;
    this.source = null;
    this.dirty = false;
    this.saving = false;
    /** Keys of the `<details>` the teacher collapsed, so they stay collapsed after redrawing. */
    this.collapsed = new Set();
    /** Redraws one field's indicator and error; filled while drawing. */
    this.updaters = [];
    this.knownPaths = new Set();
    window.addEventListener("beforeunload", (event) => {
      if (this.dirty) {
        event.preventDefault();
      }
    });
  }

  /** Loads the extraction and draws the editor. */
  async load() {
    this.root.classList.remove("d-none");
    this.root.replaceChildren(this.spinner(str("loading")));
    try {
      const response = await callBackend(this.courseId, `/syllabi/${encodeURIComponent(this.syllabusId)}/extraction`);
      this.extraction = response.content;
      this.version = response.version;
      this.source = response.source;
    } catch (error) {
      this.root.replaceChildren(this.alert("danger", str("loaderror", error.code || error.message)));
      return;
    }
    this.render();
  }

  spinner(text) {
    return el("div", { role: "status" }, el("span", { class: "spinner-border spinner-border-sm me-2", "aria-hidden": "true" }), text);
  }

  alert(type, text) {
    return el("div", { class: `alert alert-${type} mb-0`, role: type === "danger" ? "alert" : "status" }, text);
  }

  uid(prefix) {
    return uniqueId(prefix);
  }

  // -------------------------------------------------------------------------------------------
  // State changes
  // -------------------------------------------------------------------------------------------

  /**
   * Replaces the extraction after an edit.
   *
   * @param {object} extraction
   * @param {{redraw?: boolean, focus?: string}} [options] Structural changes redraw the form; field
   *     edits only refresh the indicators so the cursor stays where it is.
   */
  change(extraction, { redraw = false, focus = null } = {}) {
    this.extraction = extraction;
    this.dirty = true;
    this.status.replaceChildren();
    if (redraw) {
      this.render(focus);
    } else {
      this.refresh();
    }
  }

  /** Sets a field from a control and refreshes the indicators. */
  setField(path, value) {
    this.change(Model.editField(this.extraction, path, value));
  }

  // -------------------------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------------------------

  render(focusPath = null) {
    this.updaters = [];
    this.knownPaths = new Set();
    this.versionLabel = el("p", { class: "small text-muted" });
    this.summary = el("div", { class: "mb-3", "aria-live": "polite" });
    this.issues = el("div", { class: "mb-3" });
    this.orphans = el("div", { class: "mb-3" });
    this.status = el("div", { class: "mt-3", "aria-live": "polite" });
    this.saveButton = el("button", { type: "button", class: "btn btn-primary", onclick: () => this.save() }, str("save"));
    this.proposalButton = el(
      "button",
      { type: "button", class: "btn btn-outline-primary", onclick: () => generateProposal(this.courseId, this.syllabusId, this.version) },
      str("generateproposal"),
    );

    const form = el(
      "form",
      { novalidate: true, onsubmit: (event) => event.preventDefault() },
      this.courseSection(),
      this.outcomesSection(),
      this.periodsSection(),
      ...TEXT_LISTS.map(([key, title]) => this.textListSection(key, str(title))),
      this.instrumentsSection(),
    );

    this.root.replaceChildren(
      el("h3", { class: "h5" }, str("title")),
      el("p", { class: "text-muted" }, str("intro")),
      this.versionLabel,
      this.summary,
      this.orphans,
      this.issues,
      form,
      el("div", { class: "mt-3 d-flex gap-2 flex-wrap" }, this.saveButton, this.proposalButton),
      this.status,
    );
    this.refresh();
    if (focusPath) {
      [...this.root.querySelectorAll("[data-path]")].find((node) => node.dataset.path === focusPath)?.focus();
    }
  }

  /** Redraws the summary, warnings and every field indicator from the current state. */
  refresh() {
    this.versionLabel.textContent = str("version", {
      version: this.version,
      source: str(this.source === "TEACHER" ? "source_teacher" : "source_ai"),
    });
    const summary = Model.summarize(this.extraction);
    const parts = [];
    if (summary.uncertain) {
      parts.push(el("span", { class: "badge bg-warning text-dark me-2" }, str("summary_uncertain", summary.uncertain)));
    }
    if (summary.inconsistencies) {
      parts.push(el("span", { class: "badge bg-warning text-dark me-2" }, str("summary_issues", summary.inconsistencies)));
    }
    if (summary.errors) {
      parts.push(el("span", { class: "badge bg-danger me-2" }, str("summary_errors", summary.errors)));
    }
    this.summary.replaceChildren(...(parts.length ? parts : [el("span", { class: "badge bg-success" }, str("summary_clear"))]));
    // The proposal is built from a saved version the teacher reviewed, never from unsaved edits.
    this.proposalButton.classList.toggle("d-none", this.dirty || this.source !== "TEACHER");
    this.saveButton.disabled = this.saving || !summary.canSave;
    this.saveButton.title = summary.canSave ? "" : str("fixerrors");

    this.drawIssues();
    this.drawOrphans();
    const errors = Model.findFieldErrors(this.extraction);
    for (const update of this.updaters) {
      update(errors);
    }
  }

  drawIssues() {
    const issues = Model.findConsistencyIssues(this.extraction);
    if (issues.length === 0) {
      this.issues.replaceChildren();
      return;
    }
    this.issues.replaceChildren(
      el(
        "div",
        { class: "alert alert-warning mb-0", role: "region", "aria-label": str("issues_heading") },
        el("h4", { class: "h6" }, str("issues_heading")),
        el("p", { class: "small mb-2" }, str("issues_note")),
        el(
          "ul",
          { class: "mb-0" },
          issues.map((issue) => el("li", {}, str(`issue_${issue.code.toLowerCase()}`, issue.params))),
        ),
      ),
    );
  }

  /** Notes about something the editor has no field for (a whole list, for example) are still shown. */
  drawOrphans() {
    const orphans = this.extraction.uncertainFields.filter((field) => !this.knownPaths.has(field.path));
    this.orphans.replaceChildren(
      ...orphans.map((field) =>
        el(
          "div",
          { class: "alert alert-warning py-2 d-flex align-items-center" },
          el("span", { class: "flex-grow-1" }, `${str(`reason_${field.reason}`)}: ${field.path}${field.note ? ` (${field.note})` : ""}`),
          el("button", { type: "button", class: "btn btn-sm btn-outline-secondary", onclick: () => this.change(Model.markReviewed(this.extraction, field.path)) }, str("markreviewed")),
        ),
      ),
    );
  }

  /**
   * Builds the label, indicator, error and sources around a control.
   *
   * @param {string} path Path of the field in the extraction.
   * @param {string} label
   * @param {function(string, string): HTMLElement} makeControl Receives the control id and the id of the
   *     element that describes it, and returns the control.
   * @returns {HTMLElement}
   */
  field(path, label, makeControl) {
    this.knownPaths.add(path);
    const id = this.uid("field");
    const describedBy = `${id}-help`;
    const control = makeControl(id, describedBy);
    control.dataset.path = path;
    const flag = el("span");
    const help = el("div", { id: describedBy, class: "small" });
    this.updaters.push((errors) => this.drawFieldState(path, control, flag, help, errors));
    return el(
      "div",
      { class: "mb-3" },
      el("label", { class: "form-label", for: id }, label, flag),
      control,
      help,
    );
  }

  drawFieldState(path, control, flag, help, errors) {
    const uncertain = Model.findUncertain(this.extraction, path);
    flag.replaceChildren(
      ...(uncertain
        ? [
            el("span", { class: "badge bg-warning text-dark ms-2", title: uncertain.note || "" }, str(`reason_${uncertain.reason}`)),
            el("button", { type: "button", class: "btn btn-link btn-sm py-0", onclick: () => this.change(Model.markReviewed(this.extraction, path)) }, str("markreviewed")),
          ]
        : []),
    );
    const error = errors.find((candidate) => candidate.path === path);
    control.classList.toggle("is-invalid", Boolean(error));
    control.setAttribute("aria-invalid", error ? "true" : "false");
    const notes = [];
    if (error) {
      notes.push(el("div", { class: "text-danger" }, str(`error_${error.code}`)));
    }
    if (uncertain?.note) {
      notes.push(el("div", { class: "text-muted" }, uncertain.note));
    }
    for (const source of Model.findSources(this.extraction, path)) {
      notes.push(el("div", { class: "text-muted" }, source.page ? str("source_page", source.page) : str("source_nopage"), source.excerpt ? `: «${source.excerpt}»` : ""));
    }
    control.setAttribute("aria-describedby", help.id);
    help.replaceChildren(...notes);
  }

  // -------------------------------------------------------------------------------------------
  // Controls
  // -------------------------------------------------------------------------------------------

  /** Single-line text, or multi-line with `multiline`. `optional` turns an empty value into null. */
  textField(path, label, { multiline = false, optional = false } = {}) {
    return this.field(path, label, (id) => {
      const value = Model.getAt(this.extraction, path) ?? "";
      const props = {
        id,
        class: "form-control",
        oninput: (event) => this.setField(path, optional ? Model.parseOptionalText(event.target.value) : event.target.value),
      };
      return multiline ? el("textarea", { ...props, rows: 3 }, value) : el("input", { ...props, type: "text", value });
    });
  }

  weightField(path, label = str("field_weight")) {
    return this.field(path, label, (id) =>
      el("input", {
        id,
        type: "number",
        min: 0,
        max: 100,
        step: "any",
        class: "form-control",
        value: Model.getAt(this.extraction, path) ?? "",
        oninput: (event) => this.setField(path, event.target.validity.badInput ? Number.NaN : Model.parseWeight(event.target.value)),
      }),
    );
  }

  dateField(path, label) {
    return this.field(path, label, (id) =>
      el("input", {
        id,
        type: "date",
        class: "form-control",
        value: Model.getAt(this.extraction, path) ?? "",
        oninput: (event) => this.setField(path, event.target.validity.badInput ? "invalid" : Model.parseDate(event.target.value)),
      }),
    );
  }

  typeField(path, label) {
    return this.field(path, label, (id) =>
      el(
        "select",
        { id, class: "form-select", onchange: (event) => this.setField(path, event.target.value) },
        Model.ACTIVITY_TYPES.map((type) => el("option", { value: type, selected: Model.getAt(this.extraction, path) === type }, str(`acttype_${type}`))),
      ),
    );
  }

  /** Check boxes to link an item to learning outcomes; ids that do not exist stay visible and checked. */
  outcomeLinks(path, label) {
    const selected = Model.getAt(this.extraction, path);
    const known = this.extraction.learningOutcomes.map((outcome) => outcome.id);
    const unknown = [...new Set(selected.filter((id) => !known.includes(id)))];
    const uniqueKnown = [...new Set(known)];
    const legend = el("legend", { class: "form-label fs-6" }, label);
    const flag = el("span");
    const help = el("div", { class: "small", id: this.uid("help") });
    this.knownPaths.add(path);
    this.updaters.push((errors) => this.drawFieldState(path, legend, flag, help, errors));
    legend.append(flag);

    const options = [...uniqueKnown.map((id) => ({ id, unknown: false })), ...unknown.map((id) => ({ id, unknown: true }))];
    const boxes = options.length
      ? options.map((option) => {
          const id = this.uid("outcome");
          return el(
            "div",
            { class: "form-check form-check-inline" },
            el("input", {
              id,
              type: "checkbox",
              class: "form-check-input",
              checked: selected.includes(option.id),
              onchange: (event) => this.setOutcomeLink(path, option.id, event.target.checked),
            }),
            el("label", { class: "form-check-label", for: id }, option.unknown ? str("unknownoutcome", option.id) : option.id),
          );
        })
      : [el("span", { class: "text-muted small" }, str("nooutcomes"))];
    return el("fieldset", { class: "mb-3" }, legend, el("div", {}, boxes), help);
  }

  setOutcomeLink(path, id, checked) {
    const current = Model.getAt(this.extraction, path);
    const next = checked ? [...new Set([...current, id])] : current.filter((value) => value !== id);
    this.setField(path, next);
  }

  /** A button that adds an item and puts the cursor in it. */
  addButton(label, onclick) {
    return el("button", { type: "button", class: "btn btn-sm btn-outline-primary", onclick }, label);
  }

  /**
   * A button that removes the item at an array position.
   *
   * @param {string} arrayPath
   * @param {number} index
   * @param {string} itemLabel Name of the item, used in the button text.
   * @param {function(): object} [remove] Returns the extraction without the item; plain removal by default.
   */
  removeButton(arrayPath, index, itemLabel, remove = () => Model.removeItem(this.extraction, arrayPath, index)) {
    return el(
      "button",
      {
        type: "button",
        class: "btn btn-sm btn-outline-danger",
        onclick: () => this.change(remove(), { redraw: true }),
      },
      str("remove", itemLabel),
    );
  }

  /** A collapsible block for a period, unit or activity. */
  block(key, title, flagPath, ...content) {
    this.knownPaths.add(flagPath);
    const flag = el("span");
    this.updaters.push(() => {
      const uncertain = Model.findUncertain(this.extraction, flagPath);
      flag.replaceChildren(...(uncertain ? [el("span", { class: "badge bg-warning text-dark ms-2" }, str(`reason_${uncertain.reason}`))] : []));
    });
    return el(
      "details",
      {
        class: "card card-body mb-3",
        open: !this.collapsed.has(key),
        ontoggle: (event) => {
          if (event.target.open) {
            this.collapsed.delete(key);
          } else {
            this.collapsed.add(key);
          }
        },
      },
      el("summary", { class: "fw-bold mb-2" }, title, flag),
      ...content,
    );
  }

  // -------------------------------------------------------------------------------------------
  // Sections
  // -------------------------------------------------------------------------------------------

  section(title, ...content) {
    const id = this.uid("section");
    return el("section", { class: "mb-4", "aria-labelledby": id }, el("h4", { class: "h6", id }, title), ...content);
  }

  courseSection() {
    return this.section(
      str("section_course"),
      this.textField("course.name", str("field_coursename")),
      this.textField("course.code", str("field_coursecode"), { optional: true }),
      this.textField("course.period", str("field_period"), { optional: true }),
      this.textField("course.teacher", str("field_teacher"), { optional: true }),
      this.textField("course.generalObjective", str("field_objective"), { multiline: true, optional: true }),
    );
  }

  outcomesSection() {
    const blocks = this.extraction.learningOutcomes.map((outcome, i) => {
      const base = `learningOutcomes[${i}]`;
      const label = str("outcomen", outcome.id || i + 1);
      return this.block(
        base,
        label,
        base,
        this.outcomeIdField(i),
        this.textField(`${base}.description`, str("field_outcomedesc"), { multiline: true }),
        this.removeButton("learningOutcomes", i, label, () => Model.removeLearningOutcome(this.extraction, i)),
      );
    });
    const add = this.addButton(str("add_outcome"), () => {
      const next = Model.addItem(this.extraction, "learningOutcomes", Model.newLearningOutcome(this.extraction));
      this.change(next, { redraw: true, focus: `learningOutcomes[${next.learningOutcomes.length - 1}].description` });
    });
    return this.section(str("section_outcomes"), ...blocks, add);
  }

  /** The id is applied when the teacher leaves the field, because renaming also changes the links. */
  outcomeIdField(index) {
    const path = `learningOutcomes[${index}].id`;
    return this.field(path, str("field_outcomeid"), (id) =>
      el("input", {
        id,
        type: "text",
        class: "form-control",
        value: Model.getAt(this.extraction, path),
        onchange: (event) => this.change(Model.renameLearningOutcome(this.extraction, index, event.target.value.trim()), { redraw: true, focus: path }),
      }),
    );
  }

  periodsSection() {
    const periods = this.extraction.gradingPeriods.map((period, p) => {
      const base = `gradingPeriods[${p}]`;
      const label = str("periodn", p + 1);
      return this.block(
        base,
        `${label}: ${period.name || str("untitled")}`,
        base,
        this.textField(`${base}.name`, str("field_periodname")),
        this.weightField(`${base}.weight`),
        ...period.units.map((unit, u) => this.unitBlock(p, u)),
        this.addButton(str("add_unit"), () => {
          const next = Model.addItem(this.extraction, `${base}.units`, Model.newUnit());
          this.change(next, { redraw: true, focus: `${base}.units[${next.gradingPeriods[p].units.length - 1}].title` });
        }),
        this.removeButton("gradingPeriods", p, label),
      );
    });
    const add = this.addButton(str("add_period"), () => {
      const next = Model.addItem(this.extraction, "gradingPeriods", Model.newGradingPeriod());
      this.change(next, { redraw: true, focus: `gradingPeriods[${next.gradingPeriods.length - 1}].name` });
    });
    return this.section(str("section_periods"), ...periods, add);
  }

  unitBlock(p, u) {
    const base = `gradingPeriods[${p}].units[${u}]`;
    const unit = Model.getAt(this.extraction, base);
    const label = str("unitn", u + 1);
    return this.block(
      base,
      `${label}: ${unit.title || str("untitled")}`,
      base,
      this.textField(`${base}.title`, str("field_unittitle")),
      this.listField(`${base}.topics`, str("field_topics"), str("field_topic"), str("add_topic")),
      this.dateField(`${base}.startDate`, str("field_startdate")),
      this.dateField(`${base}.endDate`, str("field_enddate")),
      this.outcomeLinks(`${base}.learningOutcomeIds`, str("field_outcomes")),
      ...unit.activities.map((activity, a) => this.activityBlock(p, u, a)),
      this.addButton(str("add_activity"), () => {
        const next = Model.addItem(this.extraction, `${base}.activities`, Model.newActivity());
        this.change(next, { redraw: true, focus: `${base}.activities[${next.gradingPeriods[p].units[u].activities.length - 1}].title` });
      }),
      this.removeButton(`gradingPeriods[${p}].units`, u, label),
    );
  }

  activityBlock(p, u, a) {
    const base = `gradingPeriods[${p}].units[${u}].activities[${a}]`;
    const activity = Model.getAt(this.extraction, base);
    const label = str("activityn", a + 1);
    const reviewId = this.uid("review");
    return this.block(
      base,
      `${label}: ${activity.title || str("untitled")}`,
      base,
      this.textField(`${base}.title`, str("field_activitytitle")),
      this.typeField(`${base}.type`, str("field_activitytype")),
      this.textField(`${base}.description`, str("field_description"), { multiline: true, optional: true }),
      this.dateField(`${base}.suggestedDueDate`, str("field_due")),
      this.weightField(`${base}.weight`),
      this.outcomeLinks(`${base}.learningOutcomeIds`, str("field_outcomes")),
      el(
        "div",
        { class: "form-check mb-3" },
        el("input", {
          id: reviewId,
          type: "checkbox",
          class: "form-check-input",
          checked: activity.requiresTeacherReview,
          onchange: (event) => this.setField(`${base}.requiresTeacherReview`, event.target.checked),
        }),
        el("label", { class: "form-check-label", for: reviewId }, str("field_requiresreview")),
      ),
      this.removeButton(`gradingPeriods[${p}].units[${u}].activities`, a, label),
    );
  }

  /** A list of single-line values (topics, methodologies...) with add and remove buttons. */
  listField(arrayPath, groupLabel, itemLabel, addLabel) {
    const items = Model.getAt(this.extraction, arrayPath);
    const rows = items.map((_, i) => {
      const path = `${arrayPath}[${i}]`;
      return el(
        "div",
        { class: "d-flex gap-2 align-items-start" },
        el("div", { class: "flex-grow-1" }, this.textField(path, `${itemLabel} ${i + 1}`)),
        el("div", { class: "mt-4 pt-1" }, this.removeButton(arrayPath, i, `${itemLabel} ${i + 1}`)),
      );
    });
    const add = this.addButton(addLabel, () => {
      const next = Model.addItem(this.extraction, arrayPath, "");
      this.change(next, { redraw: true, focus: `${arrayPath}[${items.length}]` });
    });
    return el("fieldset", { class: "mb-3" }, el("legend", { class: "form-label fs-6" }, groupLabel), ...rows, add);
  }

  textListSection(key, title) {
    return this.section(title, this.listField(key, title, str("field_item"), str("add_item")));
  }

  instrumentsSection() {
    const rows = this.extraction.assessmentInstruments.map((_, i) => {
      const base = `assessmentInstruments[${i}]`;
      const label = `${str("field_instrument")} ${i + 1}`;
      return this.block(base, label, base, this.textField(`${base}.name`, str("field_instrument")), this.weightField(`${base}.weight`), this.removeButton("assessmentInstruments", i, label));
    });
    const add = this.addButton(str("add_instrument"), () => {
      const next = Model.addItem(this.extraction, "assessmentInstruments", { name: "", weight: null });
      this.change(next, { redraw: true, focus: `assessmentInstruments[${next.assessmentInstruments.length - 1}].name` });
    });
    return this.section(str("section_instruments"), ...rows, add);
  }

  // -------------------------------------------------------------------------------------------
  // Saving
  // -------------------------------------------------------------------------------------------

  async save() {
    if (this.saving || !Model.summarize(this.extraction).canSave) {
      return;
    }
    this.saving = true;
    this.saveButton.disabled = true;
    this.status.replaceChildren(this.spinner(str("saving")));
    try {
      const saved = await callBackend(this.courseId, `/syllabi/${encodeURIComponent(this.syllabusId)}/extraction`, {
        method: "PUT",
        json: this.extraction,
      });
      this.version = saved.version;
      this.source = saved.source;
      this.dirty = false;
      this.status.replaceChildren(this.alert("success", str("saved", saved.version)));
    } catch (error) {
      this.status.replaceChildren(this.alert("danger", str("saveerror", error.code || error.message)));
    } finally {
      this.saving = false;
      this.refresh();
    }
  }
}

/**
 * Opens the editor for a syllabus whose extraction is ready.
 *
 * @param {number} courseId
 * @param {string} syllabusId
 * @returns {Promise<void>}
 */
export const open = async (courseId, syllabusId) => {
  const root = document.querySelector('[data-region="local_ai_assistant"] [data-region="extraction-editor"]');
  if (!root) {
    return;
  }
  await loadStrings();
  await new Editor(root, courseId, syllabusId).load();
};
