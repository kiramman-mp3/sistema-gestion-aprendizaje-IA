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
 * Pure logic of the screen that relates course activities to the units of the syllabus.
 *
 * @module     local_ai_assistant/mapping_model
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/**
 * One row per activity of Moodle, with what is related to it (if anything).
 *
 * @param {Array<{cmid: number, name: string, modname: string, sectionname: string}>} activities From Moodle.
 * @param {Array<{moodleCmId: number, unitRef: string, learningOutcomeIds: string[], source: string}>} mappings From the API.
 * @returns {Array<{activity: object, unitRef: string, learningOutcomeIds: string[], source: string|null}>}
 */
export const buildRows = (activities, mappings) => {
  const byCm = new Map(mappings.map((mapping) => [mapping.moodleCmId, mapping]));
  return activities.map((activity) => {
    const mapping = byCm.get(activity.cmid);
    return {
      activity,
      unitRef: mapping?.unitRef ?? "",
      learningOutcomeIds: mapping?.learningOutcomeIds ?? [],
      source: mapping?.source ?? null,
    };
  });
};

/**
 * Relations that point to something the current syllabus no longer has (for example after a new
 * version of the syllabus), so the teacher can fix them.
 *
 * @param {Array<{unitRef: string, learningOutcomeIds: string[]}>} rows Rows with a relation.
 * @param {Array<{unitRef: string}>} units
 * @param {Array<{id: string}>} outcomes
 * @returns {Set<number>} Indexes of the rows that are out of date.
 */
export const staleRows = (rows, units, outcomes) => {
  const unitRefs = new Set(units.map((unit) => unit.unitRef));
  const outcomeIds = new Set(outcomes.map((outcome) => outcome.id));
  const stale = new Set();
  rows.forEach((row, i) => {
    if (row.unitRef && (!unitRefs.has(row.unitRef) || row.learningOutcomeIds.some((id) => !outcomeIds.has(id)))) {
      stale.add(i);
    }
  });
  return stale;
};

/**
 * Counts for the summary line.
 *
 * @param {Array<{unitRef: string}>} rows
 * @returns {{total: number, related: number, pending: number}}
 */
export const summarizeRows = (rows) => {
  const related = rows.filter((row) => row.unitRef !== "").length;
  return { total: rows.length, related, pending: rows.length - related };
};

/**
 * Outcomes to suggest when the teacher picks a unit: the ones the syllabus assigns to it.
 *
 * @param {string} unitRef
 * @param {Array<{unitRef: string, learningOutcomeIds: string[]}>} units
 * @returns {string[]}
 */
export const suggestedOutcomes = (unitRef, units) => units.find((unit) => unit.unitRef === unitRef)?.learningOutcomeIds ?? [];

/**
 * Toggles one outcome in a list.
 *
 * @param {string[]} current
 * @param {string} id
 * @param {boolean} checked
 * @returns {string[]}
 */
export const toggleOutcome = (current, id, checked) => (checked ? [...new Set([...current, id])] : current.filter((value) => value !== id));

/**
 * Body for `PUT /courses/:courseId/activity-mappings/:cmId`.
 *
 * @param {string} unitRef
 * @param {string[]} learningOutcomeIds
 * @returns {{unitRef: string, learningOutcomeIds: string[]}}
 */
export const toSaveBody = (unitRef, learningOutcomeIds) => ({ unitRef, learningOutcomeIds });

/**
 * The name of the message for an error of the mapping API.
 *
 * @param {{status?: number, code?: string}} error
 * @returns {"forbidden"|"noreviewed"|"invalid"|"other"}
 */
export const mappingErrorKind = (error) => {
  if (error.status === 403) {
    return "forbidden";
  }
  if (error.code === "NO_REVIEWED_SYLLABUS") {
    return "noreviewed";
  }
  if (error.status === 400) {
    return "invalid";
  }
  return "other";
};
