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
 * Small helpers shared by the plugin screens: building elements and loading language strings.
 *
 * @module     local_ai_assistant/ui
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import { getStrings } from "core/str";

const COMPONENT = "local_ai_assistant";

let nextId = 0;

/**
 * Returns an id that is unique on the page, for linking labels and controls.
 *
 * @param {string} prefix
 * @returns {string}
 */
export const uniqueId = (prefix) => {
  nextId += 1;
  return `local_ai_assistant-${prefix}-${nextId}`;
};

/**
 * Creates an element.
 *
 * @param {string} tag
 * @param {Object<string, *>} [props] `class`, `text`, `on<event>` handlers and attributes. null, false or
 *     undefined attributes are skipped.
 * @param {...(Node|string|null|undefined|false)} children
 * @returns {HTMLElement}
 */
export const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    if (key === "class") {
      node.className = value;
    } else if (key === "text") {
      node.textContent = value;
    } else if (key.startsWith("on")) {
      node.addEventListener(key.slice(2), value);
    } else {
      node.setAttribute(key, value === true ? "" : String(value));
    }
  }
  node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return node;
};

/**
 * Prepares the strings of one screen. All of them are requested at once, so drawing stays synchronous.
 *
 * Parameterized strings are requested with markers (`{name}`) and filled in when used.
 *
 * @param {string} prefix Strings are named `<prefix>_<name>` in the language files.
 * @param {string[]} plain Names of strings without parameters.
 * @param {Object<string, string[]|null>} parameterized `null` means a single `{$a}`; a list names the
 *     properties of `{$a->name}`.
 * @returns {{load: function(): Promise<void>, str: function(string, (string|number|Object)=): string}}
 */
export const createStrings = (prefix, plain, parameterized) => {
  let strings = null;

  const load = async () => {
    if (strings) {
      return;
    }
    const requests = plain.map((name) => ({ key: `${prefix}_${name}`, component: COMPONENT }));
    for (const [name, properties] of Object.entries(parameterized)) {
      const param = properties ? Object.fromEntries(properties.map((property) => [property, `{${property}}`])) : "{a}";
      requests.push({ key: `${prefix}_${name}`, component: COMPONENT, param });
    }
    const texts = await getStrings(requests);
    strings = {};
    requests.forEach((request, i) => {
      strings[request.key.slice(prefix.length + 1)] = texts[i];
    });
  };

  const str = (name, values) => {
    const text = strings[name];
    if (values === undefined) {
      return text;
    }
    if (typeof values === "object") {
      return Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, String(value)), text);
    }
    return text.replaceAll("{a}", String(values));
  };

  return { load, str };
};
