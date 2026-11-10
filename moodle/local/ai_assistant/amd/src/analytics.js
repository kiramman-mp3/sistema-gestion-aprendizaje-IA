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
 * Teacher dashboard and student analysis (RF-15 to RF-18, RF-20).
 *
 * The dashboard shows the indicators of the course and the signals of possible difficulty, each with its
 * explanation. From a signal the teacher opens the evidence of one student, asks for pedagogical
 * recommendations and records what they did. Student names come from Moodle, never from the backend.
 *
 * @module     local_ai_assistant/analytics
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import { callBackend, getCourseStudents } from "local_ai_assistant/assistant";
import * as Model from "local_ai_assistant/analytics_model";
import { createStrings, el, uniqueId } from "local_ai_assistant/ui";

const PLAIN_STRINGS = [
  "title", "intro", "loading", "indicators", "noindicators", "signals", "nosignals", "viewevidence", "back",
  "observed", "noobserved", "computedheading", "unknown", "unknownnote", "recommend", "recommending",
  "recommendations", "recnote", "followup", "followup_action", "followup_result", "followup_save", "followup_saved",
  "error_forbidden", "error_insufficient", "error_unavailable", "namesunavailable",
  "rule_missing_required", "rule_grade_below_threshold", "rule_sustained_decline", "rule_repeated_outcome_difficulty",
  "part_evidencesummary", "part_strengths", "part_difficulties", "part_missinginformation", "part_strategies",
  "part_reinforcementactivities", "part_followupindicators",
];

const PARAM_STRINGS = {
  computed: null,
  student: null,
  evidence_title: null,
  error_other: null,
};

const { load: loadStrings, str } = createStrings("analytics", PLAIN_STRINGS, PARAM_STRINGS);

/**
 * State and behaviour of the analytics of one course.
 */
class Analytics {
  /**
   * @param {HTMLElement} root Region where the analytics are drawn.
   * @param {number} courseId
   */
  constructor(root, courseId) {
    this.root = root;
    this.courseId = courseId;
    this.names = new Map();
    this.namesFailed = false;
  }

  show(...nodes) {
    this.root.classList.remove("d-none");
    this.root.replaceChildren(...nodes.filter(Boolean));
  }

  alert(type, text) {
    return el("div", { class: `alert alert-${type} mb-2`, role: type === "danger" ? "alert" : "status" }, text);
  }

  spinner(text) {
    return el("div", { role: "status" }, el("span", { class: "spinner-border spinner-border-sm me-2", "aria-hidden": "true" }), text);
  }

  /** The text for an error of the analytics API. */
  errorText(error) {
    const kind = Model.analyticsErrorKind(error);
    return kind === "other" ? str("error_other", error.code || error.message) : str(`error_${kind}`);
  }

  studentName(id) {
    return Model.studentLabel(this.names, id, str("student", id));
  }

  // -------------------------------------------------------------------------------------------
  // Dashboard
  // -------------------------------------------------------------------------------------------

  /** Loads and draws the dashboard of the course. */
  async showDashboard() {
    this.show(this.spinner(str("loading")));
    try {
      const [analytics, students] = await Promise.all([
        callBackend(this.courseId, `/analytics/courses/${this.courseId}`),
        getCourseStudents(this.courseId).catch(() => null),
      ]);
      this.namesFailed = students === null;
      this.names = Model.nameLookup(students ?? []);
      this.drawDashboard(analytics);
    } catch (error) {
      this.show(this.alert("danger", this.errorText(error)));
    }
  }

  drawDashboard(analytics) {
    const groups = Model.groupSignals(analytics.signals, this.names);
    this.show(
      el("h3", { class: "h5" }, str("title")),
      el("p", { class: "text-muted mb-1" }, str("intro")),
      el("p", { class: "small text-muted" }, str("computed", new Date(analytics.computedAt).toLocaleString())),
      this.namesFailed ? this.alert("warning", str("namesunavailable")) : null,
      el("h4", { class: "h6 mt-3" }, str("indicators")),
      analytics.indicators.length === 0
        ? el("p", { class: "text-muted" }, str("noindicators"))
        : el("div", { class: "row g-2 mb-3" }, analytics.indicators.map((indicator) => this.indicatorCard(indicator))),
      el("h4", { class: "h6" }, str("signals")),
      groups.length === 0 ? this.alert("success", str("nosignals")) : el("ul", { class: "list-unstyled" }, groups.map((group) => this.signalGroup(group))),
    );
  }

  /** A card with the value of an indicator and the definition of how it is calculated. */
  indicatorCard(indicator) {
    const definitionId = uniqueId("definition");
    return el(
      "div",
      { class: "col-12 col-md-6 col-lg-4" },
      el(
        "div",
        { class: "card h-100" },
        el(
          "div",
          { class: "card-body py-2" },
          el("div", { class: "small text-muted" }, indicator.label),
          el("div", { class: "fs-4 fw-bold", "aria-describedby": definitionId }, Model.formatIndicator(indicator)),
          el("div", { class: "small text-muted", id: definitionId }, indicator.definition),
        ),
      ),
    );
  }

  /** The signals of one student, each with its rule and explanation. */
  signalGroup(group) {
    return el(
      "li",
      { class: "card card-body mb-2" },
      el(
        "div",
        { class: "d-flex align-items-center gap-2 mb-1" },
        el("strong", { class: "flex-grow-1" }, this.studentName(group.studentId)),
        el("button", { type: "button", class: "btn btn-sm btn-outline-primary", onclick: () => this.showStudent(group.studentId) }, str("viewevidence")),
      ),
      el(
        "ul",
        { class: "mb-0" },
        group.signals.map((signal) => {
          const key = Model.ruleKey(signal.rule);
          return el("li", {}, el("span", { class: "badge bg-warning text-dark me-2" }, key ? str(`rule_${key}`) : signal.rule), signal.explanation);
        }),
      ),
    );
  }

  // -------------------------------------------------------------------------------------------
  // Student analysis
  // -------------------------------------------------------------------------------------------

  /** Loads and draws the evidence of one student. */
  async showStudent(studentId) {
    this.show(this.spinner(str("loading")));
    try {
      const evidence = await callBackend(this.courseId, `/analytics/courses/${this.courseId}/students/${studentId}`);
      this.drawStudent(studentId, evidence);
    } catch (error) {
      this.show(this.backButton(), this.alert("danger", this.errorText(error)));
    }
  }

  backButton() {
    return el("button", { type: "button", class: "btn btn-sm btn-outline-secondary mb-3", onclick: () => this.showDashboard() }, `← ${str("back")}`);
  }

  drawStudent(studentId, evidence) {
    this.recommendationBox = el("div", { class: "mt-3", "aria-live": "polite" });
    this.recommendButton = el("button", { type: "button", class: "btn btn-primary", onclick: () => this.recommend(studentId) }, str("recommend"));
    this.show(
      this.backButton(),
      el("h3", { class: "h5" }, str("evidence_title", this.studentName(studentId))),
      el("h4", { class: "h6 mt-3" }, str("observed")),
      evidence.observed.length === 0 ? el("p", { class: "text-muted" }, str("noobserved")) : this.observedTable(evidence.observed),
      el("h4", { class: "h6 mt-3" }, str("computedheading")),
      evidence.computed.length === 0 ? null : el("div", { class: "row g-2 mb-3" }, evidence.computed.map((indicator) => this.indicatorCard(indicator))),
      evidence.unknown.length === 0
        ? null
        : el(
            "div",
            { class: "alert alert-secondary" },
            el("strong", {}, str("unknown")),
            el("p", { class: "small mb-1" }, str("unknownnote")),
            el("ul", { class: "mb-0" }, evidence.unknown.map((text) => el("li", {}, text))),
          ),
      this.recommendButton,
      this.recommendationBox,
    );
  }

  observedTable(observed) {
    const rows = observed.flatMap((item) => Model.observedRows(item));
    return el(
      "table",
      { class: "table table-sm" },
      el("tbody", {}, rows.map((row) => el("tr", {}, el("th", { scope: "row", class: "fw-normal" }, row.label), el("td", {}, row.value)))),
    );
  }

  // -------------------------------------------------------------------------------------------
  // Recommendations and follow-up
  // -------------------------------------------------------------------------------------------

  /** Asks the backend for recommendations and shows them with the follow-up form. */
  async recommend(studentId) {
    this.recommendButton.disabled = true;
    this.recommendationBox.replaceChildren(this.spinner(str("recommending")));
    try {
      const recommendation = await callBackend(this.courseId, `/analytics/courses/${this.courseId}/students/${studentId}/recommendations`, { method: "POST" });
      this.recommendationBox.replaceChildren(...this.recommendationView(recommendation));
    } catch (error) {
      this.recommendationBox.replaceChildren(this.alert(Model.analyticsErrorKind(error) === "insufficient" ? "warning" : "danger", this.errorText(error)));
    } finally {
      this.recommendButton.disabled = false;
    }
  }

  recommendationView(recommendation) {
    return [
      el("h4", { class: "h6" }, str("recommendations")),
      el("p", { class: "small text-muted" }, str("recnote")),
      ...Model.recommendationParts(recommendation).map((part) =>
        el("div", { class: "mb-2" }, el("strong", {}, str(`part_${part.key.toLowerCase()}`)), el("ul", { class: "mb-0" }, part.items.map((text) => el("li", {}, text)))),
      ),
      this.followupForm(recommendation.id),
    ];
  }

  /** What the teacher did with the recommendation, and what happened (RF-20). */
  followupForm(recommendationId) {
    const actionId = uniqueId("action");
    const resultId = uniqueId("result");
    const status = el("div", { class: "mt-2", "aria-live": "polite" });
    const action = el("textarea", { id: actionId, class: "form-control", rows: 2, maxlength: Model.MAX_FOLLOWUP_LENGTH });
    const result = el("textarea", { id: resultId, class: "form-control", rows: 2, maxlength: Model.MAX_FOLLOWUP_LENGTH });
    const save = el("button", { type: "submit", class: "btn btn-outline-primary mt-2", disabled: true }, str("followup_save"));
    const refresh = () => {
      save.disabled = !Model.canSaveFollowup(action.value, result.value);
    };
    action.addEventListener("input", refresh);
    result.addEventListener("input", refresh);

    return el(
      "form",
      {
        class: "border-top pt-3 mt-3",
        onsubmit: async (event) => {
          event.preventDefault();
          if (save.disabled) {
            return;
          }
          save.disabled = true;
          try {
            await callBackend(this.courseId, `/recommendations/${encodeURIComponent(recommendationId)}/followups`, {
              method: "POST",
              json: Model.toFollowupBody(action.value, result.value),
            });
            action.value = "";
            result.value = "";
            status.replaceChildren(this.alert("success", str("followup_saved")));
          } catch (error) {
            status.replaceChildren(this.alert("danger", this.errorText(error)));
          }
          refresh();
        },
      },
      el("h4", { class: "h6" }, str("followup")),
      el("label", { class: "form-label", for: actionId }, str("followup_action")),
      action,
      el("label", { class: "form-label mt-2", for: resultId }, str("followup_result")),
      result,
      save,
      status,
    );
  }
}

/**
 * Entry point called from index.php: shows the dashboard to those who may view the analytics.
 *
 * @param {number} courseId
 * @returns {Promise<void>}
 */
export const init = async (courseId) => {
  const root = document.querySelector('[data-region="local_ai_assistant"] [data-region="analytics"]');
  if (!root) {
    return;
  }
  try {
    const session = await callBackend(courseId, "/session");
    if (!session.capabilities?.viewanalytics) {
      return;
    }
  } catch {
    // Without a session the connection panel already explains what is wrong.
    return;
  }
  await loadStrings();
  await new Analytics(root, courseId).showDashboard();
};
