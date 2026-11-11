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
 * Pure logic of the course proposal preview: the section/activity tree, edits, validation and the
 * body sent to `PATCH /proposals/:id`.
 *
 * Items follow `components/schemas/ProposalItem` of the API contract. Nothing here touches the DOM and
 * no function changes its input.
 *
 * @module     local_ai_assistant/proposal_model
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/** Moodle elements an activity can become (D-05, provisional). Sections are not listed: they are fixed. */
export const ACTIVITY_ITEM_TYPES = ["ASSIGN", "FORUM", "QUIZ", "LABEL", "PAGE"];

/** Proposal states in which the teacher can still change the items. */
export const EDITABLE_STATUSES = ["DRAFT", "NEEDS_REVIEW", "APPROVED"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITLE_LENGTH = 255;

/**
 * A client-side id for a new item; the backend accepts it as the item's id.
 *
 * @returns {string}
 */
export const newId = () => crypto.randomUUID();

const byPosition = (a, b) => a.position - b.position;

/**
 * @param {object[]} items
 * @returns {object[]} The sections in order.
 */
export const sectionsOf = (items) => items.filter((item) => item.itemType === "SECTION").sort(byPosition);

/**
 * @param {object[]} items
 * @param {string} sectionId
 * @returns {object[]} The activities of a section in order.
 */
export const activitiesOf = (items, sectionId) => items.filter((item) => item.parentId === sectionId).sort(byPosition);

/**
 * Items in display order: each section followed by its activities.
 *
 * @param {object[]} items
 * @returns {object[]}
 */
export const orderedItems = (items) => sectionsOf(items).flatMap((section) => [section, ...activitiesOf(items, section.id)]);

/**
 * Sets `position` to the display order, so what the teacher sees is what the backend stores.
 *
 * @param {object[]} items
 * @returns {object[]}
 */
export const renumber = (items) => orderedItems(items).map((item, position) => ({ ...item, position }));

/**
 * Changes some fields of an item.
 *
 * @param {object[]} items
 * @param {string} id
 * @param {object} changes
 * @returns {object[]}
 */
export const updateItem = (items, id, changes) => items.map((item) => (item.id === id ? { ...item, ...changes } : item));

const blankItem = (id, itemType, parentId, unitRef, position) => ({
  id,
  parentId,
  itemType,
  title: "",
  description: null,
  position,
  unitRef,
  learningOutcomeIds: [],
  dueDate: null,
  weight: null,
  moodleItemId: null,
  publishStatus: "PENDING",
});

/**
 * Adds an empty section at the end.
 *
 * @param {object[]} items
 * @param {string} [id]
 * @returns {object[]}
 */
export const addSection = (items, id = newId()) =>
  renumber([...items, blankItem(id, "SECTION", null, `custom:${id}`, items.length)]);

/**
 * Adds an empty activity at the end of a section. Dates and weights stay empty: the teacher decides.
 *
 * @param {object[]} items
 * @param {string} sectionId
 * @param {string} [id]
 * @returns {object[]}
 */
export const addActivity = (items, sectionId, id = newId()) => {
  const section = items.find((item) => item.id === sectionId);
  const last = activitiesOf(items, sectionId).at(-1) ?? section;
  const position = (last?.position ?? items.length) + 0.5;
  return renumber([...items, blankItem(id, "ASSIGN", sectionId, section.unitRef, position)]);
};

/**
 * Removes an item; removing a section also removes its activities.
 *
 * @param {object[]} items
 * @param {string} id
 * @returns {object[]}
 */
export const removeItem = (items, id) =>
  renumber(items.filter((item) => item.id !== id && item.parentId !== id));

/**
 * Moves an item up (-1) or down (1) among its siblings: sections among sections, activities within
 * their section.
 *
 * @param {object[]} items
 * @param {string} id
 * @param {-1|1} direction
 * @returns {object[]} The same items if the move is not possible.
 */
export const moveItem = (items, id, direction) => {
  const item = items.find((candidate) => candidate.id === id);
  const siblings = (item.itemType === "SECTION" ? sectionsOf(items) : activitiesOf(items, item.parentId));
  const index = siblings.findIndex((sibling) => sibling.id === id);
  const target = siblings[index + direction];
  if (!target) {
    return items;
  }
  const swapped = items.map((candidate) => {
    if (candidate.id === item.id) {
      return { ...candidate, position: target.position };
    }
    return candidate.id === target.id ? { ...candidate, position: item.position } : candidate;
  });
  return renumber(swapped);
};

/**
 * Whether an item can move in a direction (to enable or disable the buttons).
 *
 * @param {object[]} items
 * @param {string} id
 * @param {-1|1} direction
 * @returns {boolean}
 */
export const canMove = (items, id, direction) => moveItem(items, id, direction) !== items;

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
 * Finds values the backend would reject (400), so the teacher fixes them before saving. An empty title
 * is allowed here: the backend only flags it when the proposal is approved.
 *
 * @param {object[]} items
 * @returns {Array<{id: string, field: string, code: string}>} Fields: `title`, `dueDate`, `weight`.
 */
export const findFieldErrors = (items) => {
  const errors = [];
  for (const item of items) {
    if (typeof item.title === "string" && item.title.trim().length > MAX_TITLE_LENGTH) {
      errors.push({ id: item.id, field: "title", code: "toolong" });
    }
    if (!isValidDate(item.dueDate)) {
      errors.push({ id: item.id, field: "dueDate", code: "date" });
    }
    if (!isValidWeight(item.weight)) {
      errors.push({ id: item.id, field: "weight", code: "weight" });
    }
  }
  return errors;
};

/**
 * Body for `PATCH /proposals/:id`: only what the backend accepts, in display order. `moodleItemId` and
 * `publishStatus` are read-only and are not sent.
 *
 * @param {object[]} items
 * @returns {{items: object[]}}
 */
export const toPatchBody = (items) => ({
  items: orderedItems(items).map((item) => ({
    id: item.id,
    parentId: item.parentId,
    itemType: item.itemType,
    title: item.title.trim(),
    description: item.description,
    unitRef: item.unitRef,
    learningOutcomeIds: item.learningOutcomeIds,
    dueDate: item.dueDate,
    weight: item.weight,
  })),
});

/**
 * Review findings that apply to one item.
 *
 * @param {Array<{itemId: string|null}>} issues
 * @param {string} itemId
 * @returns {object[]}
 */
export const issuesForItem = (issues, itemId) => issues.filter((issue) => issue.itemId === itemId);

/**
 * Findings about the proposal as a whole (for example the weights of a period).
 *
 * @param {Array<{itemId: string|null}>} issues
 * @returns {object[]}
 */
export const generalIssues = (issues) => issues.filter((issue) => issue.itemId === null);

/**
 * Learning outcome ids in use, plus the ones the extraction defines, for the selection boxes.
 *
 * @param {object[]} items
 * @param {string[]} [known] Ids from the extraction.
 * @returns {string[]}
 */
export const outcomeOptions = (items, known = []) => [...new Set([...known, ...items.flatMap((item) => item.learningOutcomeIds)])];

/**
 * What the teacher can do with the proposal right now.
 *
 * @param {{status: string, issues: Array<{severity: string}>}} proposal
 * @param {boolean} dirty Whether there are unsaved changes.
 * @param {object[]} items The items being edited.
 * @returns {{canEdit: boolean, canSave: boolean, canApprove: boolean}}
 */
export const availableActions = (proposal, dirty, items) => {
  const canEdit = EDITABLE_STATUSES.includes(proposal.status);
  return {
    canEdit,
    canSave: canEdit && dirty && findFieldErrors(items).length === 0,
    // Approving needs the saved version: the backend checks what it has stored, not what is on screen.
    canApprove:
      proposal.status === "NEEDS_REVIEW" && !dirty && !proposal.issues.some((issue) => issue.severity === "error"),
  };
};

// ---------------------------------------------------------------------------------------------
// Publishing to Moodle
// ---------------------------------------------------------------------------------------------

/** States from which a publication can be started (or resumed after a failure). */
export const PUBLISHABLE_STATUSES = ["APPROVED", "FAILED"];

/**
 * A key that identifies one attempt to publish. Sending the same key again returns the same operation
 * instead of publishing twice, so it is created once per attempt and kept while the attempt is open.
 *
 * @returns {string} 16 to 128 characters from the set the backend accepts.
 */
export const newIdempotencyKey = () => `pub-${crypto.randomUUID()}`;

/**
 * Which part of the publication screen applies to a proposal.
 *
 * @param {{status: string}} proposal
 * @returns {"none"|"ready"|"running"|"failed"|"done"}
 */
export const publishPhase = (proposal) => {
  switch (proposal.status) {
    case "APPROVED":
      return "ready";
    case "PUBLISHING":
      return "running";
    case "FAILED":
      return "failed";
    case "PUBLISHED":
      return "done";
    default:
      return "none";
  }
};

/**
 * Progress of an operation.
 *
 * @param {{createdCount: number, totalCount: number}} operation
 * @returns {{created: number, total: number, percent: number}}
 */
export const progressOf = (operation) => {
  const total = Math.max(operation.totalCount, 0);
  const created = Math.min(operation.createdCount, total);
  return { created, total, percent: total === 0 ? 0 : Math.round((created / total) * 100) };
};

/**
 * Link to what was created in Moodle: sections open the course at that section, activities use the
 * generic activity link, which Moodle redirects to the right page.
 *
 * @param {{itemType: string, moodleItemId: number}} item
 * @param {string} wwwroot Moodle base URL.
 * @param {number} courseId
 * @returns {string}
 */
export const moodleUrl = (item, wwwroot, courseId) => {
  const base = wwwroot.replace(/\/+$/, "");
  return item.itemType === "SECTION"
    ? `${base}/course/view.php?id=${courseId}&sectionid=${item.moodleItemId}`
    : `${base}/mod/view.php?id=${item.moodleItemId}`;
};

/**
 * What was created in the course, in display order, with a link to each.
 *
 * @param {object[]} items
 * @param {string} wwwroot
 * @param {number} courseId
 * @returns {Array<{id: string, title: string, itemType: string, parentId: string|null, url: string}>}
 */
export const createdItems = (items, wwwroot, courseId) =>
  orderedItems(items)
    .filter((item) => item.publishStatus === "CREATED" && item.moodleItemId !== null)
    .map((item) => ({
      id: item.id,
      title: item.title,
      itemType: item.itemType,
      parentId: item.parentId,
      url: moodleUrl(item, wwwroot, courseId),
    }));

/**
 * The elements that failed, with the reason the backend recorded.
 *
 * @param {object[]} items
 * @returns {Array<{id: string, title: string, error: string}>}
 */
export const failedItems = (items) =>
  orderedItems(items)
    .filter((item) => item.publishStatus === "FAILED")
    .map((item) => ({ id: item.id, title: item.title, error: item.publishError ?? "PUBLISH_ERROR" }));

/**
 * Turns a failure code from the backend into the name of the message to show and its detail.
 *
 * @param {string} code For example `MOODLE_UNAVAILABLE` or `MOODLE_ERROR:invalidparameter`.
 * @returns {{key: string, detail: string|null}}
 */
export const describeFailureCode = (code) => {
  const known = {
    MOODLE_PERMISSION: "moodle_permission",
    MOODLE_UNAVAILABLE: "moodle_unavailable",
    MOODLE_BAD_RESPONSE: "moodle_bad_response",
  };
  if (known[code]) {
    return { key: known[code], detail: null };
  }
  if (code.startsWith("MOODLE_ERROR:")) {
    return { key: "moodle_error", detail: code.slice("MOODLE_ERROR:".length) };
  }
  return { key: "publish_error", detail: null };
};

/**
 * Whether the publish button can be used: the proposal is approved (or failed and can resume), the
 * teacher confirmed, nothing is half edited and no call is in flight.
 *
 * @param {{status: string}} proposal
 * @param {{confirmed: boolean, dirty: boolean, busy: boolean}} state
 * @returns {boolean}
 */
export const canPublish = (proposal, { confirmed, dirty, busy }) =>
  PUBLISHABLE_STATUSES.includes(proposal.status) && !dirty && !busy && (proposal.status === "FAILED" || confirmed);
