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

import { getString } from "core/str";
import { callBackend } from "local_ai_assistant/assistant";

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
 * Polls the backend until the syllabus leaves the processing states.
 *
 * @param {number} courseId
 * @param {string} syllabusId
 * @param {HTMLElement} progress
 * @returns {Promise<object|null>} The final syllabus, or null if it took too long.
 */
const follow = async (courseId, syllabusId, progress) => {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const syllabus = await callBackend(courseId, `/syllabi/${encodeURIComponent(syllabusId)}`);
    setProgress(progress, syllabus.progress ?? 0);
    if (syllabus.status !== "UPLOADED" && syllabus.status !== "PROCESSING") {
      return syllabus;
    }
    await wait(POLL_INTERVAL_MS);
  }
  return null;
};

/**
 * Shows the final result of the processing.
 *
 * @param {HTMLElement} status
 * @param {object|null} syllabus
 */
const showResult = async (status, syllabus) => {
  if (!syllabus) {
    show(status, "warning", [await getString("syllabustimeout", "local_ai_assistant")]);
    return;
  }
  if (syllabus.status === "FAILED") {
    const stringId = FAILURE_STRINGS[syllabus.errorCode];
    const message = stringId
      ? await getString(stringId, "local_ai_assistant")
      : await getString("syllabusfailed", "local_ai_assistant", syllabus.errorCode || "");
    show(status, "danger", [message]);
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
 * @param {number} courseId
 * @param {HTMLFormElement} form
 * @param {HTMLElement} progress
 * @param {HTMLElement} status
 */
const upload = async (courseId, form, progress, status) => {
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

  const syllabus = await follow(courseId, syllabusId, progress);
  setProgress(progress, null);
  await showResult(status, syllabus);
};

/**
 * Entry point called from index.php.
 *
 * @param {number} courseId
 */
export const init = (courseId) => {
  const region = document.querySelector('[data-region="local_ai_assistant"] [data-region="syllabus"]');
  const form = region?.querySelector('[data-action="upload-syllabus"]');
  if (!form) {
    return;
  }
  const progress = region.querySelector('[data-region="syllabus-progress"]');
  const status = region.querySelector('[data-region="syllabus-status"]');
  const button = form.querySelector('[type="submit"]');

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    try {
      await upload(courseId, form, progress, status);
    } catch (error) {
      setProgress(progress, null);
      show(status, "danger", [await getString("connectionerror", "local_ai_assistant", error.code || error.message)]);
    } finally {
      button.disabled = false;
    }
  });
};
