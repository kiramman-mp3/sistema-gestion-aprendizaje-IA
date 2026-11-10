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
 * Administration of the assistant (CU-06 and CU-07): the audit log and the difficulty rules.
 *
 * Only users with `local/ai_assistant:administer` see it. The state and the rules live in `admin_model`; this
 * module builds the page and talks to the backend. Audit events carry no names, grades or message text.
 *
 * @module     local_ai_assistant/admin
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import * as Model from "local_ai_assistant/admin_model";
import { callBackend } from "local_ai_assistant/assistant";
import { createStrings, el, uniqueId } from "local_ai_assistant/ui";

const PLAIN_STRINGS = [
  "title", "intro", "tab_audit", "tab_rules", "loading", "all", "apply",
  "filter_action", "filter_outcome", "filter_actor", "filter_course", "filter_from", "filter_to",
  "outcome_success", "outcome_denied", "outcome_error",
  "col_date", "col_action", "col_actor", "col_course", "col_result", "col_detail", "noevents", "loadmore",
  "rules_intro", "target", "target_institution", "target_course", "enabled", "save", "saved", "reset", "resetdone",
  "scope_default", "scope_institution", "scope_course", "optionalfield",
  "field_minmissing", "field_windowdays", "field_thresholdpercent", "field_minactivities", "field_consecutive",
  "rule_missing_required", "rule_grade_below_threshold", "rule_sustained_decline", "rule_repeated_outcome_difficulty",
  "error_forbidden", "error_validation", "error_notfound",
];

const PARAM_STRINGS = {
  invalidrange: ["min", "max"],
  error_other: null,
};

const { load: loadStrings, str } = createStrings("admin", PLAIN_STRINGS, PARAM_STRINGS);

const FIELD_STRINGS = {
  minMissing: "field_minmissing",
  windowDays: "field_windowdays",
  thresholdPercent: "field_thresholdpercent",
  minActivities: "field_minactivities",
  consecutive: "field_consecutive",
};

const RULE_STRINGS = {
  MISSING_REQUIRED: "rule_missing_required",
  GRADE_BELOW_THRESHOLD: "rule_grade_below_threshold",
  SUSTAINED_DECLINE: "rule_sustained_decline",
  REPEATED_OUTCOME_DIFFICULTY: "rule_repeated_outcome_difficulty",
};

const SCOPE_STRINGS = { default: "scope_default", institution: "scope_institution", course: "scope_course" };

/**
 * State and behaviour of the administration of the assistant.
 */
class Admin {
  /**
   * @param {HTMLElement} root Region where the screens are drawn.
   * @param {number} courseId Course of the token; rules can be set for it or for the whole institution.
   */
  constructor(root, courseId) {
    this.root = root;
    this.courseId = courseId;
    this.filters = {};
    this.cursor = null;
    this.target = "institution";
  }

  start() {
    this.root.classList.remove("d-none");
    this.body = el("div");
    this.root.replaceChildren(
      el("h3", { class: "h5" }, str("title")),
      el("p", { class: "text-muted" }, str("intro")),
      el(
        "div",
        { class: "btn-group mb-3", role: "group" },
        (this.auditTab = el("button", { type: "button", class: "btn btn-outline-primary", onclick: () => this.showAudit() }, str("tab_audit"))),
        (this.rulesTab = el("button", { type: "button", class: "btn btn-outline-primary", onclick: () => this.showRules() }, str("tab_rules"))),
      ),
      this.body,
    );
    return this.showAudit();
  }

  select(tab) {
    for (const [button, active] of [[this.auditTab, tab === "audit"], [this.rulesTab, tab === "rules"]]) {
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  alert(type, text, details = []) {
    const list = details.length > 0 ? el("ul", { class: "mb-0" }, ...details.map((detail) => el("li", {}, detail))) : null;
    return el("div", { class: `alert alert-${type} mb-2`, role: type === "danger" ? "alert" : "status" }, text, list);
  }

  errorAlert(error) {
    const kind = Model.adminErrorKind(error);
    const text = kind === "other" ? str("error_other", error.code || error.message) : str(`error_${kind}`);
    return this.alert("danger", text, kind === "validation" ? Model.errorDetails(error) : []);
  }

  spinner() {
    return el("div", { role: "status" }, el("span", { class: "spinner-border spinner-border-sm me-2", "aria-hidden": "true" }), str("loading"));
  }

  // -------------------------------------------------------------------------------------------
  // Audit (CU-07)
  // -------------------------------------------------------------------------------------------

  showAudit() {
    this.select("audit");
    this.cursor = null;
    this.results = el("div");
    this.more = el("div", { class: "mt-2" });
    this.body.replaceChildren(this.auditForm(), this.results, this.more);
    return this.loadAudit(false);
  }

  auditForm() {
    const field = (name, label, control) => {
      const id = uniqueId(name);
      control.id = id;
      control.name = name;
      return el("div", { class: "col-md-3" }, el("label", { class: "form-label", for: id }, label), control);
    };
    const input = (type, name) => el("input", { type, class: "form-control", value: this.filters[name] ?? "" });
    const outcome = el(
      "select",
      { class: "form-select" },
      el("option", { value: "" }, str("all")),
      ...Model.AUDIT_OUTCOMES.map((value) => el("option", { value }, str(`outcome_${value.toLowerCase()}`))),
    );
    outcome.value = this.filters.outcome ?? "";
    const form = el(
      "form",
      {
        class: "row g-2 mb-3",
        onsubmit: (event) => {
          event.preventDefault();
          this.filters = Object.fromEntries(new FormData(form).entries());
          this.cursor = null;
          this.results.replaceChildren();
          this.loadAudit(false);
        },
      },
      field("action", str("filter_action"), input("text", "action")),
      field("outcome", str("filter_outcome"), outcome),
      field("actorId", str("filter_actor"), input("number", "actorId")),
      field("courseId", str("filter_course"), input("number", "courseId")),
      field("from", str("filter_from"), input("datetime-local", "from")),
      field("to", str("filter_to"), input("datetime-local", "to")),
      el("div", { class: "col-md-3 d-flex align-items-end" }, el("button", { type: "submit", class: "btn btn-primary" }, str("apply"))),
    );
    return form;
  }

  async loadAudit(append) {
    this.more.replaceChildren();
    const spinner = this.spinner();
    this.more.append(spinner);
    try {
      const page = await callBackend(this.courseId, `/audit?${Model.auditQuery(this.filters, append ? this.cursor : null)}`);
      this.cursor = page.nextCursor;
      this.drawRows(page.items, append);
      this.more.replaceChildren(
        page.nextCursor ? el("button", { type: "button", class: "btn btn-outline-secondary", onclick: () => this.loadAudit(true) }, str("loadmore")) : null,
      );
    } catch (error) {
      this.more.replaceChildren();
      this.results.replaceChildren(this.errorAlert(error));
    }
  }

  drawRows(events, append) {
    if (!append && events.length === 0) {
      this.results.replaceChildren(this.alert("info", str("noevents")));
      return;
    }
    let tbody = this.results.querySelector("tbody");
    if (!append || !tbody) {
      tbody = el("tbody");
      this.results.replaceChildren(
        el(
          "div",
          { class: "table-responsive" },
          el(
            "table",
            { class: "table table-sm" },
            el("thead", {}, el("tr", {}, ...["col_date", "col_action", "col_actor", "col_course", "col_result", "col_detail"].map((key) => el("th", { scope: "col" }, str(key))))),
            tbody,
          ),
        ),
      );
    }
    for (const event of events) {
      tbody.append(
        el(
          "tr",
          {},
          el("td", {}, new Date(event.createdAt).toLocaleString()),
          el("td", {}, event.action),
          el("td", {}, event.actorMoodleId === null ? "—" : String(event.actorMoodleId)),
          el("td", {}, event.courseId === null ? "—" : String(event.courseId)),
          el("td", {}, el("span", { class: `badge ${Model.outcomeBadge(event.outcome)}` }, str(`outcome_${event.outcome.toLowerCase()}`))),
          el("td", { class: "small" }, Model.eventDetail(event)),
        ),
      );
    }
  }

  // -------------------------------------------------------------------------------------------
  // Difficulty rules (CU-06)
  // -------------------------------------------------------------------------------------------

  showRules() {
    this.select("rules");
    this.notice = el("div");
    this.list = el("div");
    const name = uniqueId("target");
    const radio = (value, label) =>
      el(
        "div",
        { class: "form-check form-check-inline" },
        el("input", {
          type: "radio",
          class: "form-check-input",
          name,
          id: `${name}-${value}`,
          value,
          checked: this.target === value,
          onchange: () => {
            this.target = value;
            this.loadRules();
          },
        }),
        el("label", { class: "form-check-label", for: `${name}-${value}` }, label),
      );
    this.body.replaceChildren(
      el("p", { class: "text-muted" }, str("rules_intro")),
      el("fieldset", { class: "mb-3" }, el("legend", { class: "h6" }, str("target")), radio("institution", str("target_institution")), radio("course", str("target_course"))),
      this.notice,
      this.list,
    );
    return this.loadRules();
  }

  get targetCourseId() {
    return this.target === "course" ? this.courseId : null;
  }

  async loadRules() {
    this.list.replaceChildren(this.spinner());
    try {
      const query = this.targetCourseId === null ? "" : `?courseId=${this.targetCourseId}`;
      const { rules } = await callBackend(this.courseId, `/admin/difficulty-rules${query}`);
      this.list.replaceChildren(...rules.map((rule) => this.ruleCard(rule)));
    } catch (error) {
      this.list.replaceChildren(this.errorAlert(error));
    }
  }

  ruleCard(rule) {
    const enabledId = uniqueId("enabled");
    const enabled = el("input", { type: "checkbox", class: "form-check-input", id: enabledId, checked: rule.enabled });
    const inputs = new Map();
    const fields = Model.RULE_FIELDS[rule.rule].map((spec) => {
      const id = uniqueId(spec.name);
      const input = el("input", {
        type: "number",
        class: "form-control",
        id,
        min: spec.min,
        max: spec.max,
        step: spec.integer ? 1 : "any",
        value: rule.params[spec.name] ?? "",
        required: !spec.optional,
        "aria-describedby": `${id}-error`,
      });
      const error = el("div", { class: "invalid-feedback", id: `${id}-error` });
      inputs.set(spec.name, { input, error });
      const label = spec.optional ? `${str(FIELD_STRINGS[spec.name])} (${str("optionalfield")})` : str(FIELD_STRINGS[spec.name]);
      return el("div", { class: "col-md-4" }, el("label", { class: "form-label", for: id }, label), input, error);
    });
    const feedback = el("div", { class: "mt-2" });

    const save = async () => {
      const { params, errors } = Model.validateRuleForm(rule.rule, Object.fromEntries([...inputs].map(([name, { input }]) => [name, input.value])));
      for (const [name, { input, error }] of inputs) {
        const range = errors[name];
        input.classList.toggle("is-invalid", Boolean(range));
        error.textContent = range ? str("invalidrange", range) : "";
      }
      if (Object.keys(errors).length > 0) {
        return;
      }
      try {
        const saved = await callBackend(this.courseId, `/admin/difficulty-rules/${rule.rule}`, {
          method: "PUT",
          json: Model.toRuleRequest(this.targetCourseId, enabled.checked, params),
        });
        feedback.replaceChildren(this.alert("success", str("saved")));
        scope.textContent = str(SCOPE_STRINGS[saved.scope]);
      } catch (error) {
        feedback.replaceChildren(this.errorAlert(error));
      }
    };
    const reset = async () => {
      try {
        await callBackend(this.courseId, `/admin/difficulty-rules/${rule.rule}${this.targetCourseId === null ? "" : `?courseId=${this.targetCourseId}`}`, { method: "DELETE" });
        await this.loadRules();
        this.notice.replaceChildren(this.alert("success", str("resetdone")));
      } catch (error) {
        // Nothing to reset (404) is not worth an alert: the card already shows the default or inherited value.
        feedback.replaceChildren(Model.adminErrorKind(error) === "notfound" ? this.alert("info", str("error_notfound")) : this.errorAlert(error));
      }
    };

    const scope = el("span", { class: "badge bg-secondary ms-2" }, str(SCOPE_STRINGS[rule.scope]));
    return el(
      "section",
      { class: "card mb-3" },
      el(
        "form",
        {
          class: "card-body",
          novalidate: true,
          onsubmit: (event) => {
            event.preventDefault();
            save();
          },
        },
        el("h4", { class: "h6" }, str(RULE_STRINGS[rule.rule]), scope),
        el("div", { class: "form-check mb-2" }, enabled, el("label", { class: "form-check-label", for: enabledId }, str("enabled"))),
        el("div", { class: "row g-2 mb-2" }, ...fields),
        el(
          "div",
          { class: "d-flex gap-2" },
          el("button", { type: "submit", class: "btn btn-primary" }, str("save")),
          el("button", { type: "button", class: "btn btn-outline-secondary", onclick: reset }, str("reset")),
        ),
        feedback,
      ),
    );
  }
}

/**
 * Entry point called from index.php. Draws nothing for users without the `admin` capability.
 *
 * @param {number} courseId
 * @returns {Promise<void>}
 */
export const init = async (courseId) => {
  const root = document.querySelector('[data-region="local_ai_assistant"] [data-region="admin"]');
  if (!root) {
    return;
  }
  try {
    const session = await callBackend(courseId, "/session");
    if (!session.capabilities?.admin) {
      return;
    }
  } catch {
    // Without a session the connection panel already explains what is wrong.
    return;
  }
  await loadStrings();
  await new Admin(root, courseId).start();
};
