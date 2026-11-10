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
 * Assistant page: checks the connection with the Smart LMS backend.
 *
 * @module     local_ai_assistant/assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import Ajax from "core/ajax";
import { getString } from "core/str";
import { readEvents } from "local_ai_assistant/sse";

const CAPABILITY_STRINGS = {
  use: "capuse",
  publish: "cappublish",
  viewanalytics: "capviewanalytics",
};

/**
 * Asks Moodle for a single-use token for the backend. The signing secret never reaches the browser.
 *
 * @param {number} courseId
 * @returns {Promise<{token: string, backendurl: string}>}
 */
const getBackendToken = (courseId) =>
  Ajax.call([{ methodname: "local_ai_assistant_get_backend_token", args: { courseid: courseId } }])[0];

/**
 * Lists the students of the course with their names. Moodle answers it with the teacher's session: the
 * names never go through the backend.
 *
 * @param {number} courseId
 * @returns {Promise<Array<{id: number, fullname: string}>>}
 */
export const getCourseStudents = (courseId) =>
  Ajax.call([{ methodname: "local_ai_assistant_get_course_students", args: { courseid: courseId } }])[0];

/**
 * Lists the activities of the course. Moodle answers it with the teacher's session.
 *
 * @param {number} courseId
 * @returns {Promise<Array<{cmid: number, name: string, modname: string, sectionnum: number, sectionname: string, visible: boolean}>>}
 */
export const getCourseActivities = (courseId) =>
  Ajax.call([{ methodname: "local_ai_assistant_get_course_activities", args: { courseid: courseId } }])[0];

/**
 * Calls the backend with a fresh token. Each token is accepted only once.
 *
 * @param {number} courseId
 * @param {string} path Path under the API prefix, for example "/session".
 * @param {{method?: string, body?: FormData, json?: object, headers?: Object<string, string>}} [options]
 *     A FormData body is sent as multipart; `json` is sent as a JSON body; `headers` adds headers, for
 *     example `Idempotency-Key`.
 * @returns {Promise<object>}
 */
export const callBackend = async (courseId, path, options = {}) => {
  const { token, backendurl } = await getBackendToken(courseId);
  const headers = { ...options.headers, Authorization: `Bearer ${token}`, Accept: "application/json" };
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${backendurl.replace(/\/+$/, "")}${path}`, {
    method: options.method || "GET",
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
    headers,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || `HTTP ${response.status}`);
    error.code = body.code;
    error.status = response.status;
    error.details = body.details;
    throw error;
  }
  return body;
};

/**
 * POSTs to the backend and reads the answer as a stream of events (Server-Sent Events).
 *
 * If the backend answers with plain JSON instead of a stream, that body is delivered as a single `final`
 * event, so the caller handles both the same way.
 *
 * @param {number} courseId
 * @param {string} path Path under the API prefix.
 * @param {{json: object, onEvent: function({event: string, data: string}): void, signal?: AbortSignal}} options
 * @returns {Promise<void>} Resolves when the stream ends; rejects with `code` and `status` on an HTTP error.
 */
export const streamBackend = async (courseId, path, { json, onEvent, signal }) => {
  const { token, backendurl } = await getBackendToken(courseId);
  const response = await fetch(`${backendurl.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify(json),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.message || `HTTP ${response.status}`);
    error.code = body.code;
    error.status = response.status;
    throw error;
  }
  if (!(response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    onEvent({ event: "final", data: JSON.stringify(await response.json()) });
    return;
  }
  await readEvents(response, onEvent);
};

/**
 * Renders the connection result as a list of capabilities.
 *
 * @param {HTMLElement} status
 * @param {{roles: string[], capabilities: Object<string, boolean>}} session
 */
const renderConnected = async (status, session) => {
  const [connected, yes, no] = await Promise.all([
    getString("connected", "local_ai_assistant"),
    getString("yes"),
    getString("no"),
  ]);
  const items = await Promise.all(
    Object.entries(CAPABILITY_STRINGS).map(async ([key, stringId]) => {
      const label = await getString(stringId, "local_ai_assistant");
      const li = document.createElement("li");
      li.textContent = `${label}: ${session.capabilities[key] ? yes : no}`;
      return li;
    }),
  );

  const message = document.createElement("p");
  message.className = "text-success mb-2";
  message.textContent = connected;
  const list = document.createElement("ul");
  list.className = "mb-0";
  list.append(...items);
  status.replaceChildren(message, list);
};

/**
 * Renders a connection error without exposing technical details beyond the error code.
 *
 * @param {HTMLElement} status
 * @param {Error & {code?: string}} error
 */
const renderError = async (status, error) => {
  const text = await getString("connectionerror", "local_ai_assistant", error.code || error.message);
  const alert = document.createElement("div");
  alert.className = "alert alert-danger mb-0";
  alert.setAttribute("role", "alert");
  alert.textContent = text;
  status.replaceChildren(alert);
};

/**
 * Entry point called from index.php.
 *
 * @param {number} courseId
 */
export const init = async (courseId) => {
  const root = document.querySelector('[data-region="local_ai_assistant"]');
  const status = root?.querySelector('[data-region="status"]');
  if (!status) {
    return;
  }
  try {
    await renderConnected(status, await callBackend(courseId, "/session"));
  } catch (error) {
    await renderError(status, error);
  }
};
