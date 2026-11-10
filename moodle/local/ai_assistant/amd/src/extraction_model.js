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
 * Pure logic of the syllabus extraction editor: edits, validation and review state.
 *
 * It works on plain objects that follow the extraction schema v1 (`packages/contracts`). It has no
 * DOM access, so it can be tested outside Moodle. All functions return new objects; none of them
 * changes its input.
 *
 * @module     local_ai_assistant/extraction_model
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/** Same list as `ACTIVITY_TYPES` in `packages/contracts`. */
export const ACTIVITY_TYPES = ["assignment", "forum", "quiz", "exam", "practice", "project", "resource", "other"];

/** Same list as the `reason` of `uncertainFieldSchema`. */
export const UNCERTAIN_REASONS = ["missing", "ambiguous", "low_confidence", "inconsistent"];

const WEIGHT_TOLERANCE = 0.01;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------------------------
// Paths such as `gradingPeriods[0].units[1].title`
// ---------------------------------------------------------------------------------------------

/**
 * Splits a path into keys (strings) and indexes (numbers).
 *
 * @param {string} path
 * @returns {Array<string|number>}
 */
export const parsePath = (path) => {
  const tokens = [];
  for (const match of path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) {
    tokens.push(match[2] !== undefined ? Number(match[2]) : match[1]);
  }
  return tokens;
};

/**
 * Builds a path from its tokens.
 *
 * @param {Array<string|number>} tokens
 * @returns {string}
 */
export const formatPath = (tokens) =>
  tokens.reduce((path, token) => (typeof token === "number" ? `${path}[${token}]` : path ? `${path}.${token}` : token), "");

/**
 * Reads the value at a path.
 *
 * @param {object} data
 * @param {string} path
 * @returns {*} The value, or undefined if the path does not exist.
 */
export const getAt = (data, path) => parsePath(path).reduce((node, token) => node?.[token], data);

/**
 * Returns a copy of the data with the value at the path replaced.
 *
 * @param {object} data
 * @param {string} path
 * @param {*} value
 * @returns {object}
 */
export const setAt = (data, path, value) => {
  const copy = structuredClone(data);
  const tokens = parsePath(path);
  const last = tokens.pop();
  const parent = tokens.reduce((node, token) => node[token], copy);
  parent[last] = value;
  return copy;
};

// ---------------------------------------------------------------------------------------------
// Adding and removing items
// ---------------------------------------------------------------------------------------------

/**
 * Rewrites the paths of `uncertainFields` and `sourceReferences` after an item of an array was
 * removed: entries about the removed item are dropped and the following indexes shift down.
 *
 * @param {string} path
 * @param {Array<string|number>} arrayTokens Tokens of the array the item was removed from.
 * @param {number} removedIndex
 * @returns {string|null} The new path, or null if the path pointed into the removed item.
 */
const shiftPath = (path, arrayTokens, removedIndex) => {
  const tokens = parsePath(path);
  const inArray = arrayTokens.every((token, i) => tokens[i] === token);
  const index = tokens[arrayTokens.length];
  if (!inArray || typeof index !== "number") {
    return path;
  }
  if (index === removedIndex) {
    return null;
  }
  if (index > removedIndex) {
    tokens[arrayTokens.length] = index - 1;
  }
  return formatPath(tokens);
};

/**
 * Removes an item from an array of the extraction and keeps the review notes in step.
 *
 * @param {object} extraction
 * @param {string} arrayPath For example `gradingPeriods[0].units`.
 * @param {number} index
 * @returns {object}
 */
export const removeItem = (extraction, arrayPath, index) => {
  const copy = structuredClone(extraction);
  getAt(copy, arrayPath).splice(index, 1);
  const arrayTokens = parsePath(arrayPath);
  for (const key of ["uncertainFields", "sourceReferences"]) {
    copy[key] = copy[key].flatMap((entry) => {
      const path = shiftPath(entry.path, arrayTokens, index);
      return path === null ? [] : [{ ...entry, path }];
    });
  }
  return copy;
};

/**
 * Appends an item to an array of the extraction.
 *
 * @param {object} extraction
 * @param {string} arrayPath
 * @param {*} item
 * @returns {object}
 */
export const addItem = (extraction, arrayPath, item) => {
  const copy = structuredClone(extraction);
  getAt(copy, arrayPath).push(item);
  return copy;
};

/**
 * Applies a function to every list of learning outcome ids (units and activities).
 *
 * @param {object} extraction Modified in place; pass a copy.
 * @param {function(string[]): string[]} change
 */
const mapOutcomeReferences = (extraction, change) => {
  for (const period of extraction.gradingPeriods) {
    for (const unit of period.units) {
      unit.learningOutcomeIds = change(unit.learningOutcomeIds);
      for (const activity of unit.activities) {
        activity.learningOutcomeIds = change(activity.learningOutcomeIds);
      }
    }
  }
};

/**
 * Changes the id of a learning outcome and the references to it, so renaming does not break links.
 *
 * @param {object} extraction
 * @param {number} index Position of the outcome.
 * @param {string} newId
 * @returns {object}
 */
export const renameLearningOutcome = (extraction, index, newId) => {
  const copy = structuredClone(extraction);
  const oldId = copy.learningOutcomes[index].id;
  copy.learningOutcomes[index].id = newId;
  const shared = copy.learningOutcomes.some((outcome, i) => i !== index && outcome.id === oldId);
  if (!shared && oldId !== newId) {
    mapOutcomeReferences(copy, (ids) => ids.map((id) => (id === oldId ? newId : id)));
  }
  return copy;
};

/**
 * Removes a learning outcome and, unless another outcome has the same id, the references to it.
 *
 * @param {object} extraction
 * @param {number} index
 * @returns {object}
 */
export const removeLearningOutcome = (extraction, index) => {
  const oldId = extraction.learningOutcomes[index].id;
  const copy = removeItem(extraction, "learningOutcomes", index);
  if (!copy.learningOutcomes.some((outcome) => outcome.id === oldId)) {
    mapOutcomeReferences(copy, (ids) => ids.filter((id) => id !== oldId));
  }
  return copy;
};

/** @returns {object} A new learning outcome with the next free id (`RA1`, `RA2`...). */
export const newLearningOutcome = (extraction) => {
  const used = new Set(extraction.learningOutcomes.map((outcome) => outcome.id));
  let n = extraction.learningOutcomes.length + 1;
  while (used.has(`RA${n}`)) {
    n++;
  }
  return { id: `RA${n}`, description: "" };
};

/** @returns {object} An empty grading period. */
export const newGradingPeriod = () => ({ name: "", weight: null, units: [] });

/** @returns {object} An empty unit. */
export const newUnit = () => ({
  title: "",
  topics: [],
  learningOutcomeIds: [],
  startDate: null,
  endDate: null,
  activities: [],
});

/** @returns {object} An empty activity; the teacher must review it. */
export const newActivity = () => ({
  title: "",
  type: "assignment",
  description: null,
  suggestedDueDate: null,
  weight: null,
  learningOutcomeIds: [],
  requiresTeacherReview: true,
});

// ---------------------------------------------------------------------------------------------
// Review state: uncertain fields and sources
// ---------------------------------------------------------------------------------------------

/**
 * Whether a recorded path is the given path or something inside it.
 *
 * @param {string} entryPath
 * @param {string} path
 * @returns {boolean}
 */
const isWithin = (entryPath, path) =>
  entryPath === path || entryPath.startsWith(`${path}.`) || entryPath.startsWith(`${path}[`);

/**
 * Finds the open review note for a field.
 *
 * @param {object} extraction
 * @param {string} path
 * @returns {{path: string, reason: string, note: string|null}|undefined}
 */
export const findUncertain = (extraction, path) => extraction.uncertainFields.find((field) => field.path === path);

/**
 * Sources cited for a field or for the item that contains it.
 *
 * @param {object} extraction
 * @param {string} path
 * @returns {Array<{path: string, page: number|null, excerpt: string|null}>}
 */
export const findSources = (extraction, path) =>
  extraction.sourceReferences.filter((source) => isWithin(path, source.path));

/**
 * Marks a field as reviewed by the teacher: removes its note from `uncertainFields`.
 *
 * @param {object} extraction
 * @param {string} path
 * @returns {object}
 */
export const markReviewed = (extraction, path) => ({
  ...extraction,
  uncertainFields: extraction.uncertainFields.filter((field) => field.path !== path),
});

/**
 * Sets a field and, because the teacher looked at it, marks it as reviewed.
 *
 * @param {object} extraction
 * @param {string} path
 * @param {*} value
 * @returns {object}
 */
export const editField = (extraction, path, value) => markReviewed(setAt(extraction, path, value), path);

/**
 * Parses the text of a weight field.
 *
 * @param {string} text
 * @returns {number|null} A number, or null when the field is empty.
 */
export const parseWeight = (text) => {
  const trimmed = String(text).trim().replace(",", ".");
  return trimmed === "" ? null : Number(trimmed);
};

/**
 * Parses the text of a date field.
 *
 * @param {string} text
 * @returns {string|null} The text, or null when the field is empty.
 */
export const parseDate = (text) => {
  const trimmed = String(text).trim();
  return trimmed === "" ? null : trimmed;
};

/**
 * Normalizes the text of an optional text field: empty means "not in the syllabus".
 *
 * @param {string} text
 * @returns {string|null}
 */
export const parseOptionalText = (text) => {
  const trimmed = String(text).trim();
  return trimmed === "" ? null : trimmed;
};

// ---------------------------------------------------------------------------------------------
// Validation: what the backend schema would reject
// ---------------------------------------------------------------------------------------------

const isEmpty = (text) => typeof text !== "string" || text.trim() === "";

const isValidDate = (value) => {
  if (value === null) {
    return true;
  }
  if (typeof value !== "string" || !ISO_DATE.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
};

const isValidWeight = (value) => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100);

/**
 * Finds values the backend would reject, so the teacher fixes them before saving.
 *
 * @param {object} extraction
 * @returns {Array<{code: string, path: string}>} Codes: `required`, `weight`, `date`, `outcomeid`.
 */
export const findFieldErrors = (extraction) => {
  const errors = [];
  const mustHaveText = (text, path) => {
    if (isEmpty(text)) {
      errors.push({ code: "required", path });
    }
  };
  const checkWeight = (value, path) => {
    if (!isValidWeight(value)) {
      errors.push({ code: "weight", path });
    }
  };
  const checkDate = (value, path) => {
    if (!isValidDate(value)) {
      errors.push({ code: "date", path });
    }
  };

  mustHaveText(extraction.course.name, "course.name");

  extraction.learningOutcomes.forEach((outcome, i) => {
    const base = `learningOutcomes[${i}]`;
    if (!/^[A-Za-z0-9._-]+$/.test(outcome.id)) {
      errors.push({ code: "outcomeid", path: `${base}.id` });
    }
    mustHaveText(outcome.description, `${base}.description`);
  });

  extraction.gradingPeriods.forEach((period, p) => {
    const periodPath = `gradingPeriods[${p}]`;
    mustHaveText(period.name, `${periodPath}.name`);
    checkWeight(period.weight, `${periodPath}.weight`);
    period.units.forEach((unit, u) => {
      const unitPath = `${periodPath}.units[${u}]`;
      mustHaveText(unit.title, `${unitPath}.title`);
      unit.topics.forEach((topic, t) => mustHaveText(topic, `${unitPath}.topics[${t}]`));
      checkDate(unit.startDate, `${unitPath}.startDate`);
      checkDate(unit.endDate, `${unitPath}.endDate`);
      unit.activities.forEach((activity, a) => {
        const activityPath = `${unitPath}.activities[${a}]`;
        mustHaveText(activity.title, `${activityPath}.title`);
        checkDate(activity.suggestedDueDate, `${activityPath}.suggestedDueDate`);
        checkWeight(activity.weight, `${activityPath}.weight`);
      });
    });
  });

  extraction.assessmentInstruments.forEach((instrument, i) => {
    mustHaveText(instrument.name, `assessmentInstruments[${i}].name`);
    checkWeight(instrument.weight, `assessmentInstruments[${i}].weight`);
  });
  for (const key of ["methodologies", "resources", "bibliography"]) {
    extraction[key].forEach((text, i) => mustHaveText(text, `${key}[${i}]`));
  }

  return errors;
};

// ---------------------------------------------------------------------------------------------
// Consistency: business rules the schema cannot express
// ---------------------------------------------------------------------------------------------

const sum = (values) => values.reduce((total, value) => total + value, 0);

/**
 * Checks the business rules on the current state so the teacher sees problems while editing.
 *
 * It must give the same codes and paths as `findConsistencyIssues` in `packages/contracts`
 * (a test compares both). The backend repeats the check when it saves.
 *
 * @param {object} syllabus
 * @returns {Array<{code: string, path: string, params: object}>} `params` fills the localized message.
 */
export const findConsistencyIssues = (syllabus) => {
  const issues = [];
  const knownOutcomes = new Set();

  syllabus.learningOutcomes.forEach((outcome, i) => {
    if (knownOutcomes.has(outcome.id)) {
      issues.push({ code: "DUPLICATE_LEARNING_OUTCOME_ID", path: `learningOutcomes[${i}].id`, params: { id: outcome.id } });
    }
    knownOutcomes.add(outcome.id);
  });

  const checkOutcomeRefs = (ids, path) => {
    ids.forEach((id, i) => {
      if (!knownOutcomes.has(id)) {
        issues.push({ code: "UNKNOWN_LEARNING_OUTCOME", path: `${path}.learningOutcomeIds[${i}]`, params: { id } });
      }
    });
  };

  const periodWeights = syllabus.gradingPeriods.map((period) => period.weight);
  if (periodWeights.length > 0 && periodWeights.every((weight) => weight !== null)) {
    const total = sum(periodWeights);
    if (Math.abs(total - 100) > WEIGHT_TOLERANCE) {
      issues.push({ code: "GRADING_PERIOD_WEIGHTS_NOT_100", path: "gradingPeriods", params: { total } });
    }
  }

  syllabus.gradingPeriods.forEach((period, p) => {
    const periodPath = `gradingPeriods[${p}]`;
    const activityWeights = [];

    period.units.forEach((unit, u) => {
      const unitPath = `${periodPath}.units[${u}]`;
      checkOutcomeRefs(unit.learningOutcomeIds, unitPath);

      if (unit.startDate && unit.endDate && unit.startDate > unit.endDate) {
        issues.push({ code: "UNIT_DATES_REVERSED", path: unitPath, params: { title: unit.title } });
      }

      unit.activities.forEach((activity, a) => {
        const activityPath = `${unitPath}.activities[${a}]`;
        checkOutcomeRefs(activity.learningOutcomeIds, activityPath);

        if (activity.learningOutcomeIds.length === 0 && unit.learningOutcomeIds.length === 0) {
          issues.push({ code: "ACTIVITY_WITHOUT_LEARNING_OUTCOME", path: activityPath, params: { title: activity.title } });
        }

        const due = activity.suggestedDueDate;
        if (due && ((unit.startDate && due < unit.startDate) || (unit.endDate && due > unit.endDate))) {
          issues.push({ code: "DUE_DATE_OUTSIDE_UNIT", path: `${activityPath}.suggestedDueDate`, params: { title: activity.title } });
        }

        if (activity.weight !== null) {
          activityWeights.push(activity.weight);
        }
      });
    });

    const activityTotal = sum(activityWeights);
    if (activityTotal > 100 + WEIGHT_TOLERANCE) {
      issues.push({ code: "ACTIVITY_WEIGHTS_EXCEED_100", path: periodPath, params: { name: period.name, total: activityTotal } });
    }
  });

  return issues;
};

/**
 * Summary shown above the editor: how much is left to review.
 *
 * @param {object} extraction
 * @returns {{uncertain: number, inconsistencies: number, errors: number, canSave: boolean}}
 *   `canSave` is false only while there are values the backend would reject; warnings do not block.
 */
export const summarize = (extraction) => {
  const errors = findFieldErrors(extraction).length;
  return {
    uncertain: extraction.uncertainFields.length,
    inconsistencies: findConsistencyIssues(extraction).length,
    errors,
    canSave: errors === 0,
  };
};
