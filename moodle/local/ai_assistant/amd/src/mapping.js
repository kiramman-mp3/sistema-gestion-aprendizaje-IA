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
 * Relation of the activities of the course with the units and learning outcomes of the syllabus.
 *
 * The activities come from Moodle (with the teacher's session) and the units from the backend. Each change
 * is saved at once, row by row.
 *
 * @module     local_ai_assistant/mapping
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import { callBackend, getCourseActivities } from "local_ai_assistant/assistant";
import * as Model from "local_ai_assistant/mapping_model";
import { createStrings, el, uniqueId } from "local_ai_assistant/ui";

const PLAIN_STRINGS = [
  "title", "intro", "loading", "noreviewed", "noactivities", "activity", "unit", "outcomes", "none", "hidden",
  "source_proposal", "source_manual", "stale", "saving", "saved", "readonly",
  "error_forbidden", "error_noreviewed", "error_invalid",
];

const PARAM_STRINGS = {
  summary: ["related", "total"],
  unitlabel: null,
  loaderror: null,
  error_other: null,
};

const { load: loadStrings, str } = createStrings("mapping", PLAIN_STRINGS, PARAM_STRINGS);

/**
 * State and behaviour of the relations of one course.
 */
class Mapping {
  /**
   * @param {HTMLElement} root Region where the screen is drawn.
   * @param {number} courseId
   * @param {boolean} canEdit Whether the teacher may change the relations.
   */
  constructor(root, courseId, canEdit) {
    this.root = root;
    this.courseId = courseId;
    this.canEdit = canEdit;
    this.rows = [];
    this.units = [];
    this.outcomes = [];
  }

  show(...nodes) {
    this.root.classList.remove("d-none");
    this.root.replaceChildren(...nodes.filter(Boolean));
  }

  alert(type, text) {
    return el("div", { class: `alert alert-${type} mb-2`, role: type === "danger" ? "alert" : "status" }, text);
  }

  /** Loads the activities and the units, and draws the table. */
  async start() {
    this.show(el("div", { role: "status" }, str("loading")));
    try {
      const [activities, overview] = await Promise.all([
        getCourseActivities(this.courseId),
        callBackend(this.courseId, `/courses/${this.courseId}/activity-mappings`),
      ]);
      this.units = overview.units;
      this.outcomes = overview.outcomes;
      this.rows = Model.buildRows(activities, overview.mappings);
    } catch (error) {
      this.show(this.alert("danger", str("loaderror", error.code || error.message)));
      return;
    }
    this.render();
  }

  render() {
    if (this.units.length === 0) {
      this.show(el("h3", { class: "h5" }, str("title")), this.alert("warning", str("noreviewed")));
      return;
    }
    this.summary = el("p", { class: "small text-muted", "aria-live": "polite" });
    this.show(
      el("h3", { class: "h5" }, str("title")),
      el("p", { class: "text-muted" }, str("intro")),
      this.canEdit ? null : this.alert("secondary", str("readonly")),
      this.summary,
      this.rows.length === 0 ? el("p", { class: "text-muted" }, str("noactivities")) : this.table(),
    );
    this.refreshSummary();
  }

  refreshSummary() {
    const { related, total } = Model.summarizeRows(this.rows);
    this.summary.textContent = str("summary", { related, total });
  }

  table() {
    const stale = Model.staleRows(this.rows, this.units, this.outcomes);
    return el(
      "div",
      { class: "table-responsive" },
      el(
        "table",
        { class: "table align-middle" },
        el("thead", {}, el("tr", {}, el("th", { scope: "col" }, str("activity")), el("th", { scope: "col" }, str("unit")), el("th", { scope: "col" }, str("outcomes")))),
        el("tbody", {}, this.rows.map((row, i) => this.rowView(row, i, stale.has(i)))),
      ),
    );
  }

  rowView(row, index, isStale) {
    const status = el("div", { class: "small", "aria-live": "polite" });
    this.showSource(status, row, isStale);
    const selectId = uniqueId("unit");
    const select = el(
      "select",
      {
        id: selectId,
        class: "form-select form-select-sm",
        disabled: !this.canEdit,
        "aria-label": str("unitlabel", row.activity.name),
        onchange: (event) => this.changeUnit(index, event.target.value, status),
      },
      el("option", { value: "" }, str("none")),
      ...this.units.map((unit) => el("option", { value: unit.unitRef, selected: unit.unitRef === row.unitRef }, `${unit.periodName}: ${unit.title}`)),
    );
    return el(
      "tr",
      { "data-cm": row.activity.cmid },
      el(
        "td",
        {},
        el("div", { class: "fw-bold" }, row.activity.name),
        el("div", { class: "small text-muted" }, `${row.activity.modname} · ${row.activity.sectionname}`, row.activity.visible ? "" : ` · ${str("hidden")}`),
      ),
      el("td", {}, select, status),
      el("td", {}, this.outcomeBoxes(row, index, status)),
    );
  }

  /** Shows where the relation came from, or why it needs attention. */
  showSource(status, row, isStale) {
    const nodes = [];
    if (isStale) {
      nodes.push(el("span", { class: "text-danger" }, str("stale")));
    } else if (row.source) {
      nodes.push(el("span", { class: "text-muted" }, str(row.source === "PROPOSAL" ? "source_proposal" : "source_manual")));
    }
    status.replaceChildren(...nodes);
  }

  outcomeBoxes(row, index, status) {
    return this.outcomes.map((outcome) => {
      const id = uniqueId("outcome");
      return el(
        "div",
        { class: "form-check form-check-inline" },
        el("input", {
          id,
          type: "checkbox",
          class: "form-check-input",
          checked: row.learningOutcomeIds.includes(outcome.id),
          disabled: !this.canEdit || row.unitRef === "",
          title: outcome.description,
          onchange: (event) => this.changeOutcomes(index, Model.toggleOutcome(this.rows[index].learningOutcomeIds, outcome.id, event.target.checked), status),
        }),
        el("label", { class: "form-check-label", for: id, title: outcome.description }, outcome.id),
      );
    });
  }

  /** The teacher picked another unit, or none. */
  async changeUnit(index, unitRef, status) {
    const row = this.rows[index];
    if (unitRef === "") {
      await this.save(index, status, () => callBackend(this.courseId, `/courses/${this.courseId}/activity-mappings/${row.activity.cmid}`, { method: "DELETE" }), () => ({
        unitRef: "",
        learningOutcomeIds: [],
        source: null,
      }));
      return;
    }
    // A unit with no outcomes yet gets the ones the syllabus assigns to it; otherwise the choice is kept.
    const outcomes = row.unitRef === "" ? Model.suggestedOutcomes(unitRef, this.units) : row.learningOutcomeIds;
    await this.saveRelation(index, unitRef, outcomes, status);
  }

  changeOutcomes(index, outcomes, status) {
    return this.saveRelation(index, this.rows[index].unitRef, outcomes, status);
  }

  saveRelation(index, unitRef, outcomes, status) {
    const row = this.rows[index];
    return this.save(
      index,
      status,
      () => callBackend(this.courseId, `/courses/${this.courseId}/activity-mappings/${row.activity.cmid}`, { method: "PUT", json: Model.toSaveBody(unitRef, outcomes) }),
      (saved) => ({ unitRef: saved.unitRef, learningOutcomeIds: saved.learningOutcomeIds, source: saved.source }),
    );
  }

  /** Runs a change, shows the progress and updates the row from the answer. */
  async save(index, status, call, toRow) {
    status.replaceChildren(el("span", { class: "text-muted" }, str("saving")));
    try {
      const saved = await call();
      this.rows[index] = { ...this.rows[index], ...toRow(saved) };
      // Redraw the row so the outcome boxes follow the new unit.
      const old = this.root.querySelector(`tr[data-cm="${this.rows[index].activity.cmid}"]`);
      old.replaceWith(this.rowView(this.rows[index], index, false));
      const fresh = this.root.querySelector(`tr[data-cm="${this.rows[index].activity.cmid}"] [aria-live]`);
      fresh.replaceChildren(el("span", { class: "text-success" }, str("saved")));
      this.refreshSummary();
    } catch (error) {
      const kind = Model.mappingErrorKind(error);
      status.replaceChildren(el("span", { class: "text-danger", role: "alert" }, kind === "other" ? str("error_other", error.code || error.message) : str(`error_${kind}`)));
    }
  }
}

/**
 * Entry point called from index.php.
 *
 * @param {number} courseId
 * @returns {Promise<void>}
 */
export const init = async (courseId) => {
  const root = document.querySelector('[data-region="local_ai_assistant"] [data-region="mapping"]');
  if (!root) {
    return;
  }
  let canEdit;
  try {
    canEdit = (await callBackend(courseId, "/session")).capabilities?.publish === true;
  } catch {
    // Without a session the connection panel already explains what is wrong.
    return;
  }
  await loadStrings();
  await new Mapping(root, courseId, canEdit).start();
};
