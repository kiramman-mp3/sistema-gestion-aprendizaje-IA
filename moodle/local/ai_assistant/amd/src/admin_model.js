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
 * Pure logic of the administration screens (CU-06 and CU-07): the audit filters, the rows of the audit table and
 * the form of the difficulty rules.
 *
 * The contract is `GET /audit`, `GET /admin/difficulty-rules` and `PUT|DELETE /admin/difficulty-rules/:rule`
 * (docs/api/openapi.yaml). The backend validates everything again; these rules only give early feedback.
 *
 * @module     local_ai_assistant/admin_model
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

export const AUDIT_OUTCOMES = ["SUCCESS", "DENIED", "ERROR"];

/** Rows asked for per page of the audit. */
export const AUDIT_PAGE_SIZE = 50;

/**
 * The query string of `GET /audit`.
 *
 * @param {{courseId?: string, actorId?: string, action?: string, outcome?: string, from?: string, to?: string}} filters
 *     Values as typed; `from` and `to` come from `datetime-local` inputs (`2026-11-10T08:30`).
 * @param {string|null} [cursor] `nextCursor` of the previous page.
 * @returns {string} Without the leading `?`.
 */
export const auditQuery = (filters, cursor = null) => {
  const params = new URLSearchParams({ limit: String(AUDIT_PAGE_SIZE) });
  for (const key of ["courseId", "actorId", "action", "outcome"]) {
    const value = String(filters[key] ?? "").trim();
    if (value) {
      params.set(key, value);
    }
  }
  for (const key of ["from", "to"]) {
    const iso = toIso(filters[key]);
    if (iso) {
      params.set(key, iso);
    }
  }
  if (cursor) {
    params.set("cursor", cursor);
  }
  return params.toString();
};

/**
 * Turns the value of a `datetime-local` input into an ISO date in UTC.
 *
 * @param {string|undefined} value
 * @returns {string|null} Null when empty or not a date.
 */
export const toIso = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
};

/**
 * What the audit table shows in its detail column: the metadata of the event, which the backend keeps free of
 * names, grades and message text.
 *
 * @param {{metadata: Object<string, string|number|boolean|null>|null, resourceType?: string|null, resourceId?: string|null}} event
 * @returns {string}
 */
export const eventDetail = (event) => {
  const parts = [];
  if (event.resourceType) {
    parts.push(event.resourceId ? `${event.resourceType} ${event.resourceId}` : event.resourceType);
  }
  for (const [key, value] of Object.entries(event.metadata ?? {})) {
    parts.push(`${key}=${value === null ? "—" : String(value)}`);
  }
  return parts.join(", ");
};

/**
 * Badge tone of an outcome (styled in styles.css).
 *
 * @param {string} outcome
 * @returns {string}
 */
export const outcomeBadge = (outcome) =>
  ({ SUCCESS: "lai-success", DENIED: "lai-warning", ERROR: "lai-danger" })[outcome] ?? "lai-secondary";

/**
 * Parameters each rule accepts, with the limits the backend enforces (`difficulty-rules.ts`).
 * `integer: false` allows decimals; `optional` fields are left out when empty.
 */
export const RULE_FIELDS = {
  MISSING_REQUIRED: [
    { name: "minMissing", min: 1, max: 1000, integer: true, optional: false },
    { name: "windowDays", min: 1, max: 365, integer: true, optional: true },
  ],
  GRADE_BELOW_THRESHOLD: [
    { name: "thresholdPercent", min: 0, max: 100, integer: false, optional: false },
    { name: "minActivities", min: 1, max: 1000, integer: true, optional: false },
    { name: "windowDays", min: 1, max: 365, integer: true, optional: true },
  ],
  SUSTAINED_DECLINE: [
    { name: "consecutive", min: 3, max: 10, integer: true, optional: false },
    { name: "windowDays", min: 1, max: 365, integer: true, optional: true },
  ],
  REPEATED_OUTCOME_DIFFICULTY: [
    { name: "thresholdPercent", min: 0, max: 100, integer: false, optional: false },
    { name: "minActivities", min: 1, max: 1000, integer: true, optional: false },
    { name: "windowDays", min: 1, max: 365, integer: true, optional: true },
  ],
};

/**
 * Validates what was typed in a rule form.
 *
 * @param {string} rule One of the keys of `RULE_FIELDS`.
 * @param {Object<string, string>} raw Field values as typed.
 * @returns {{params: Object<string, number>, errors: Object<string, {min: number, max: number}>}} `errors` names
 *     the invalid fields with their allowed range; `params` holds the valid values.
 */
export const validateRuleForm = (rule, raw) => {
  const params = {};
  const errors = {};
  for (const field of RULE_FIELDS[rule] ?? []) {
    const text = String(raw[field.name] ?? "").trim();
    if (text === "") {
      if (!field.optional) {
        errors[field.name] = { min: field.min, max: field.max };
      }
      continue;
    }
    const value = Number(text);
    const valid = Number.isFinite(value) && value >= field.min && value <= field.max && (!field.integer || Number.isInteger(value));
    if (valid) {
      params[field.name] = value;
    } else {
      errors[field.name] = { min: field.min, max: field.max };
    }
  }
  return { params, errors };
};

/**
 * The body of `PUT /admin/difficulty-rules/:rule`.
 *
 * @param {number|null} courseId Null configures the whole institution.
 * @param {boolean} enabled
 * @param {Object<string, number>} params
 * @returns {{courseId: number|null, enabled: boolean, params: Object<string, number>}}
 */
export const toRuleRequest = (courseId, enabled, params) => ({ courseId, enabled, params });

/**
 * The name of the message to show for an error of the admin API.
 *
 * @param {{code?: string, status?: number}} error
 * @returns {string} One of `forbidden`, `validation`, `notfound`, `other`.
 */
export const adminErrorKind = (error) => {
  if (error.status === 403 || (error.code && error.code.startsWith("FORBIDDEN"))) {
    return "forbidden";
  }
  if (error.status === 400 || error.code === "VALIDATION_ERROR") {
    return "validation";
  }
  if (error.status === 404 || error.code === "RULE_NOT_FOUND") {
    return "notfound";
  }
  return "other";
};

/**
 * The fields the backend rejected, as `path: message` lines.
 *
 * @param {{details?: Array<{path?: string, message?: string}>}} error
 * @returns {string[]}
 */
export const errorDetails = (error) =>
  (Array.isArray(error.details) ? error.details : [])
    .filter((detail) => detail && typeof detail.message === "string")
    .slice(0, 5)
    .map((detail) => (detail.path ? `${detail.path}: ${detail.message}` : detail.message));
