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
 * Syllabus upload on the assistant page: sends the file to the backend and follows its processing.
 *
 * @module     local_ai_assistant/syllabus
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import { deleteCancelPromise } from "core/notification";
import { getString } from "core/str";
import { callBackend } from "local_ai_assistant/assistant";
import { open as openExtractionEditor } from "local_ai_assistant/extraction_editor";

/** Same limit as the backend (RF-03); checked here only to answer faster. */
const MAX_BYTES = 10 * 1024 * 1024;
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const FAILURE_STRINGS = {
  CORRUPT_DOCUMENT: "syllabusfailed_corrupt",
  EMPTY_DOCUMENT: "syllabusfailed_empty",
  ENCRYPTED_DOCUMENT: "syllabusfailed_encrypted",
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The text is still being extracted (or the file is waiting for the queue). */
const isReadingText = (syllabus) => syllabus.status === "UPLOADED" || syllabus.status === "PROCESSING";

/** The structure extraction finished, successfully or not. */
const isExtractionDone = (syllabus) => ["EXTRACTED", "REVIEWED", "FAILED"].includes(syllabus.status);

/**
 * Shows a message in the status region.
 *
 * @param {HTMLElement} status
 * @param {string} type Bootstrap alert type: info, success, warning or danger.
 * @param {string[]} messages
 */
const show = (status, type, messages) => {
  const alert = document.createElement("div");
  alert.className = `alert alert-${type} mb-0`;
  alert.setAttribute("role", type === "danger" ? "alert" : "status");
  for (const message of messages) {
    const paragraph = document.createElement("p");
    paragraph.className = "mb-0";
    paragraph.textContent = message;
    alert.append(paragraph);
  }
  status.replaceChildren(alert);
};

/**
 * Updates the progress bar; null hides it.
 *
 * @param {HTMLElement} progress
 * @param {number|null} percent
 */
const setProgress = (progress, percent) => {
  progress.classList.toggle("d-none", percent === null);
  const bar = progress.querySelector('[role="progressbar"]');
  const value = String(percent ?? 0);
  bar.style.width = `${value}%`;
  bar.setAttribute("aria-valuenow", value);
};

/**
 * Polls the backend until the syllabus reaches a state the caller considers final.
 *
 * @param {number} courseId
 * @param {string} syllabusId
 * @param {HTMLElement} progress
 * @param {function(object): boolean} [isDone] Defaults to "the text is no longer being read".
 * @returns {Promise<object|null>} The final syllabus, or null if it took too long.
 */
const follow = async (courseId, syllabusId, progress, isDone = (syllabus) => !isReadingText(syllabus)) => {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const syllabus = await callBackend(courseId, `/syllabi/${encodeURIComponent(syllabusId)}`);
    setProgress(progress, syllabus.progress ?? 0);
    if (isDone(syllabus)) {
      return syllabus;
    }
    await wait(POLL_INTERVAL_MS);
  }
  return null;
};

/**
 * Remembers the syllabus on screen and shows the discard button for it.
 *
 * @param {{discard: HTMLElement}} view
 * @param {string|null} syllabusId
 */
const setCurrent = (view, syllabusId) => {
  view.syllabusId = syllabusId;
  view.discard.classList.toggle("d-none", !syllabusId);
};

/**
 * Opens the page again without a syllabus or proposal in the URL, so every panel starts empty. An object so the
 * tests can replace it: jsdom does not navigate.
 */
export const reload = {
  run: () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("syllabusid");
    url.searchParams.delete("proposalid");
    window.location.assign(url.toString());
  },
};

/**
 * Asks for confirmation and discards the syllabus on screen with everything the assistant generated from it.
 * Nothing published to the course is touched: the backend refuses (409) if a proposal was published.
 *
 * @param {{courseId: number, status: HTMLElement, syllabusId: string|null}} view
 * @param {HTMLButtonElement} button
 */
const discard = async (view, button) => {
  const { courseId, status, syllabusId } = view;
  try {
    await deleteCancelPromise(
      getString("syllabusdiscardtitle", "local_ai_assistant"),
      getString("syllabusdiscardconfirm", "local_ai_assistant"),
      getString("syllabusdiscard", "local_ai_assistant"),
    );
  } catch {
    // The teacher cancelled.
    return;
  }
  button.disabled = true;
  try {
    await callBackend(courseId, `/syllabi/${encodeURIComponent(syllabusId)}`, { method: "DELETE" });
  } catch (error) {
    button.disabled = false;
    const published = error.code === "SYLLABUS_PUBLISHED";
    const message = published
      ? await getString("syllabusdiscardpublished", "local_ai_assistant")
      : await getString("syllabusdiscardfailed", "local_ai_assistant", error.code || error.message);
    show(status, published ? "warning" : "danger", [message]);
    return;
  }
  setCurrent(view, null);
  show(status, "success", [await getString("syllabusdiscarded", "local_ai_assistant")]);
  reload.run();
};

/**
 * Starts the structure extraction and opens the editor when it is ready.
 *
 * @param {{courseId: number, progress: HTMLElement, status: HTMLElement}} view
 * @param {string} syllabusId
 */
const extractStructure = async (view, syllabusId) => {
  const { courseId, progress, status } = view;
  show(status, "info", [await getString("syllabusextracting", "local_ai_assistant")]);
  setProgress(progress, 0);
  try {
    await callBackend(courseId, `/syllabi/${encodeURIComponent(syllabusId)}/extract`, { method: "POST" });
    const syllabus = await follow(courseId, syllabusId, progress, isExtractionDone);
    setProgress(progress, null);
    await showResult(view, syllabus);
  } catch (error) {
    setProgress(progress, null);
    show(status, "danger", [await getString("syllabusextractfailed", "local_ai_assistant", error.code || error.message)]);
  }
};

/**
 * Shows the final result of the processing.
 *
 * @param {{courseId: number, progress: HTMLElement, status: HTMLElement}} view
 * @param {object|null} syllabus
 * @param {{autoExtract?: boolean}} [options] `autoExtract` goes on to extract the structure as soon as the text is
 *     ready (the teacher used "Upload and create the structure"). A scanned text of low confidence is the
 *     exception: the teacher sees the warning first and decides.
 */
const showResult = async (view, syllabus, { autoExtract = false } = {}) => {
  const { courseId, status } = view;
  if (!syllabus) {
    show(status, "warning", [await getString("syllabustimeout", "local_ai_assistant")]);
    return;
  }
  setCurrent(view, syllabus.id);
  if (syllabus.status === "FAILED") {
    const stringId = FAILURE_STRINGS[syllabus.errorCode];
    const message = stringId
      ? await getString(stringId, "local_ai_assistant")
      : await getString("syllabusfailed", "local_ai_assistant", syllabus.errorCode || "");
    show(status, "danger", [message]);
    return;
  }
  if (syllabus.status === "EXTRACTED" || syllabus.status === "REVIEWED") {
    status.replaceChildren();
    await openExtractionEditor(courseId, syllabus.id);
    return;
  }
  const messages = [
    syllabus.pageCount
      ? await getString("syllabusready", "local_ai_assistant", syllabus.pageCount)
      : await getString("syllabusreadynopages", "local_ai_assistant"),
  ];
  if (syllabus.textConfidence === "low") {
    messages.push(await getString("syllabuslowconfidence", "local_ai_assistant"));
  }
  show(status, syllabus.textConfidence === "low" ? "warning" : "success", messages);

  if (syllabus.status === "TEXT_READY" && autoExtract && syllabus.textConfidence !== "low") {
    await extractStructure(view, syllabus.id);
    return;
  }

  if (syllabus.status === "TEXT_READY") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-primary mt-2";
    button.textContent = await getString("syllabusextract", "local_ai_assistant");
    button.addEventListener("click", () => {
      button.disabled = true;
      extractStructure(view, syllabus.id);
    });
    status.append(button);
  }
};

/**
 * Checks the file before sending it. Returns the message to show, or null if it looks valid.
 *
 * @param {File|undefined} file
 * @returns {Promise<string|null>}
 */
const checkFile = async (file) => {
  if (!file || !/\.(pdf|docx)$/i.test(file.name)) {
    return getString("syllabustype", "local_ai_assistant");
  }
  if (file.size > MAX_BYTES) {
    return getString("syllabustoolarge", "local_ai_assistant");
  }
  return null;
};

/**
 * Uploads the selected file and follows its processing.
 *
 * @param {{courseId: number, progress: HTMLElement, status: HTMLElement}} view
 * @param {HTMLFormElement} form
 * @param {boolean} createStructure Also extract the structure when the text is ready.
 */
const upload = async (view, form, createStructure) => {
  const { courseId, progress, status } = view;
  const file = form.elements.file.files[0];
  const invalid = await checkFile(file);
  if (invalid) {
    show(status, "danger", [invalid]);
    return;
  }

  const body = new FormData();
  body.set("courseId", String(courseId));
  body.set("file", file, file.name);
  show(status, "info", [await getString("syllabusuploading", "local_ai_assistant")]);
  setProgress(progress, 0);

  let syllabusId;
  try {
    syllabusId = (await callBackend(courseId, "/syllabi", { method: "POST", body })).id;
    show(status, "info", [await getString("syllabusprocessing", "local_ai_assistant")]);
  } catch (error) {
    if (error.code === "DUPLICATE_SYLLABUS" && error.details?.[0]?.message) {
      // The backend returns the id of the existing syllabus: show its status instead.
      syllabusId = error.details[0].message;
      show(status, "info", [await getString("syllabusduplicate", "local_ai_assistant")]);
    } else {
      setProgress(progress, null);
      const message = error.status === 413 ? await getString("syllabustoolarge", "local_ai_assistant")
        : await getString("syllabusrejected", "local_ai_assistant", error.message);
      show(status, "danger", [message]);
      return;
    }
  }

  setCurrent(view, syllabusId);
  const syllabus = await follow(courseId, syllabusId, progress);
  setProgress(progress, null);
  await showResult(view, syllabus, { autoExtract: createStructure });
};

/**
 * Shows the state of an already uploaded syllabus, so the teacher can come back to it.
 *
 * @param {{courseId: number, progress: HTMLElement, status: HTMLElement}} view
 * @param {string} syllabusId
 */
const resume = async (view, syllabusId) => {
  const { courseId, progress, status } = view;
  setCurrent(view, syllabusId);
  try {
    const syllabus = await follow(courseId, syllabusId, progress);
    setProgress(progress, null);
    await showResult(view, syllabus);
  } catch (error) {
    setProgress(progress, null);
    show(status, "danger", [await getString("connectionerror", "local_ai_assistant", error.code || error.message)]);
  }
};

/**
 * Picks up the course's most recent syllabus when the page opens without one in the URL, so the teacher finds
 * their work where they left it instead of an empty form. A course with no syllabus (404) shows nothing.
 *
 * @param {{courseId: number, progress: HTMLElement, status: HTMLElement}} view
 */
const resumeLatest = async (view) => {
  let latest;
  try {
    latest = await callBackend(view.courseId, "/syllabi/latest");
  } catch {
    // No syllabus yet, or the backend is not reachable: the connection card already says so.
    return;
  }
  if (latest?.id) {
    await resume(view, latest.id);
  }
};

/**
 * Entry point called from index.php.
 *
 * @param {number} courseId
 * @param {string} [syllabusId] A syllabus to resume (from the `syllabusid` URL parameter); without one, the
 *     course's most recent syllabus is resumed.
 */
export const init = (courseId, syllabusId = "") => {
  const region = document.querySelector('[data-region="local_ai_assistant"] [data-region="syllabus"]');
  const form = region?.querySelector('[data-action="upload-syllabus"]');
  if (!form) {
    return;
  }
  const progress = region.querySelector('[data-region="syllabus-progress"]');
  const status = region.querySelector('[data-region="syllabus-status"]');
  const buttons = [...form.querySelectorAll('[type="submit"]')];
  const discardRegion = region.querySelector('[data-region="syllabus-discard"]');
  const view = { courseId, progress, status, discard: discardRegion, syllabusId: null };
  const discardButton = discardRegion.querySelector('[data-action="discard-syllabus"]');
  discardButton.addEventListener("click", () => discard(view, discardButton));

  if (syllabusId) {
    resume(view, syllabusId);
  } else {
    resumeLatest(view);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    // The main button uploads and goes on to the structure; the other one only uploads.
    const createStructure = event.submitter?.dataset.action === "upload-and-structure";
    buttons.forEach((button) => {
      button.disabled = true;
    });
    try {
      await upload(view, form, createStructure);
    } catch (error) {
      setProgress(progress, null);
      show(status, "danger", [await getString("connectionerror", "local_ai_assistant", error.code || error.message)]);
    } finally {
      buttons.forEach((button) => {
        button.disabled = false;
      });
    }
  });
};
