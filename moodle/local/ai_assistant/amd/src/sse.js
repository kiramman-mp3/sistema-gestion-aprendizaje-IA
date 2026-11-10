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
 * Reader of Server-Sent Events over `fetch`.
 *
 * `EventSource` cannot send a POST body or an Authorization header, which the chat needs, so the stream
 * is read from the response body and parsed here.
 *
 * @module     local_ai_assistant/sse
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/**
 * Splits the text received so far into complete events and what is left over.
 *
 * An event ends with a blank line. Lines starting with `:` are comments, `event:` names the event
 * (default `message`) and several `data:` lines are joined with a line break.
 *
 * @param {string} buffer Text not yet parsed, including the new chunk.
 * @returns {{events: Array<{event: string, data: string}>, rest: string}}
 */
export const parseEvents = (buffer) => {
  const normalized = buffer.replace(/\r\n?/g, "\n");
  const blocks = normalized.split("\n\n");
  // The last block has no blank line after it yet: it may be incomplete.
  const rest = blocks.pop() ?? "";
  const events = [];
  for (const block of blocks) {
    let event = "message";
    const data = [];
    for (const line of block.split("\n")) {
      if (line === "" || line.startsWith(":")) {
        continue;
      }
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") {
        event = value;
      } else if (field === "data") {
        data.push(value);
      }
    }
    if (data.length > 0 || event !== "message") {
      events.push({ event, data: data.join("\n") });
    }
  }
  return { events, rest };
};

/**
 * Reads a response body as events and hands each one to a callback, as soon as it arrives.
 *
 * @param {Response} response A fetch response whose body is an event stream.
 * @param {function({event: string, data: string}): void} onEvent
 * @returns {Promise<void>} Resolves when the stream ends.
 */
export const readEvents = async (response, onEvent) => {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const parsed = parseEvents(done ? `${buffer}\n\n` : buffer);
    buffer = parsed.rest;
    parsed.events.forEach(onEvent);
    if (done) {
      return;
    }
  }
};
