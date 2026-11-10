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
 * Pure logic of the analytics screens (RF-15 to RF-18, RF-20): how indicators, signals, evidence and
 * recommendations are shown.
 *
 * The shapes are the ones of `docs/api/openapi.yaml` (`CourseAnalytics`, `StudentEvidence`,
 * `Recommendation`). Nothing here touches the DOM.
 *
 * @module     local_ai_assistant/analytics_model
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/** Same limit as the API (`actionTaken` and `observedResult`). */
export const MAX_FOLLOWUP_LENGTH = 2000;

/** Parts of a recommendation, in the order they are shown, with the field of the API each one reads. */
export const RECOMMENDATION_SECTIONS = [
  "evidenceSummary",
  "strengths",
  "difficulties",
  "missingInformation",
  "strategies",
  "reinforcementActivities",
  "followUpIndicators",
];

/** Difficulty rules the backend can report, with the name of the message that explains each (RF-16). */
const RULE_KEYS = {
  MISSING_REQUIRED: "missing_required",
  GRADE_BELOW_THRESHOLD: "grade_below_threshold",
  SUSTAINED_DECLINE: "sustained_decline",
  REPEATED_OUTCOME_DIFFICULTY: "repeated_outcome_difficulty",
};

/**
 * The name of the message for a rule, or null if the rule is not known to this version of the plugin.
 *
 * @param {string} rule
 * @returns {string|null}
 */
export const ruleKey = (rule) => RULE_KEYS[rule] ?? null;

/**
 * Formats the value of an indicator. A missing value is shown as a dash, never as zero.
 *
 * @param {{value: number|null, unit?: string|null}} indicator
 * @param {string} [locale] Defaults to the browser language.
 * @returns {string}
 */
export const formatIndicator = (indicator, locale) => {
  if (indicator.value === null || indicator.value === undefined || Number.isNaN(indicator.value)) {
    return "—";
  }
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(indicator.value);
  return indicator.unit ? `${number}${indicator.unit === "%" ? "" : " "}${indicator.unit}` : number;
};

/**
 * Names by student id.
 *
 * @param {Array<{id: number, fullname: string}>} students
 * @returns {Map<number, string>}
 */
export const nameLookup = (students) => new Map(students.map((student) => [student.id, student.fullname]));

/**
 * The name to show for a student; if Moodle does not list the student (for example, they left the course),
 * the id is shown so the signal is not lost.
 *
 * @param {Map<number, string>} names
 * @param {number} studentId
 * @param {string} fallback Text for an unknown student, such as `Student 12`.
 * @returns {string}
 */
export const studentLabel = (names, studentId, fallback) => names.get(studentId) ?? fallback;

/**
 * Signals grouped by student, students with more signals first, then by name.
 *
 * @param {Array<{studentId: number, rule: string, explanation: string}>} signals
 * @param {Map<number, string>} names
 * @returns {Array<{studentId: number, signals: object[]}>}
 */
export const groupSignals = (signals, names) => {
  const groups = new Map();
  for (const signal of signals) {
    groups.set(signal.studentId, [...(groups.get(signal.studentId) ?? []), signal]);
  }
  return [...groups.entries()]
    .map(([studentId, list]) => ({ studentId, signals: list }))
    .sort((a, b) => b.signals.length - a.signals.length || (names.get(a.studentId) ?? "").localeCompare(names.get(b.studentId) ?? ""));
};

/**
 * Turns an observed datum into label/value pairs. The backend sends `{label, value}` or a flat object; both
 * are shown without guessing what a field means.
 *
 * @param {object} item
 * @returns {Array<{label: string, value: string}>}
 */
export const observedRows = (item) => {
  const text = (value) => (value === null || value === undefined ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value));
  if (typeof item.label === "string" && "value" in item) {
    return [{ label: item.label, value: text(item.value) }];
  }
  return Object.entries(item).map(([label, value]) => ({ label, value: text(value) }));
};

/**
 * The parts of a recommendation that have content, in display order.
 *
 * @param {object} recommendation
 * @returns {Array<{key: string, items: string[]}>}
 */
export const recommendationParts = (recommendation) =>
  RECOMMENDATION_SECTIONS.map((key) => ({ key, items: Array.isArray(recommendation[key]) ? recommendation[key] : [] })).filter((part) => part.items.length > 0);

/**
 * Whether a follow-up can be saved: the action is required.
 *
 * @param {string} actionTaken
 * @param {string} [observedResult]
 * @returns {boolean}
 */
export const canSaveFollowup = (actionTaken, observedResult = "") =>
  actionTaken.trim().length > 0 && actionTaken.trim().length <= MAX_FOLLOWUP_LENGTH && observedResult.trim().length <= MAX_FOLLOWUP_LENGTH;

/**
 * Body for `POST /recommendations/:id/followups`; an empty result is sent as null.
 *
 * @param {string} actionTaken
 * @param {string} [observedResult]
 * @returns {{actionTaken: string, observedResult: string|null}}
 */
export const toFollowupBody = (actionTaken, observedResult = "") => ({
  actionTaken: actionTaken.trim(),
  observedResult: observedResult.trim() === "" ? null : observedResult.trim(),
});

/**
 * The name of the message for an error of the analytics API.
 *
 * @param {{status?: number, code?: string}} error
 * @returns {"forbidden"|"insufficient"|"unavailable"|"other"}
 */
export const analyticsErrorKind = (error) => {
  if (error.status === 403) {
    return "forbidden";
  }
  if (error.status === 422) {
    return "insufficient";
  }
  if (error.status === 503 || error.code === "AI_PROVIDER_UNAVAILABLE") {
    return "unavailable";
  }
  return "other";
};
