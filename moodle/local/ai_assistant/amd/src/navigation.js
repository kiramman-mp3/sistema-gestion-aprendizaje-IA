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
 * Tabs of the assistant page: one panel per task instead of one endless page.
 *
 * The template draws the tabs and the panels; the screens (syllabus, proposal, chat...) keep drawing into their own
 * `data-region` as before. This module only decides which panel is shown. A tab is hidden while its panel has nothing
 * to show: a screen that hides itself (no permission, no proposal yet) hides its tab too.
 *
 * @module     local_ai_assistant/navigation
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/** The tab opened when nothing says otherwise. */
const DEFAULT_TAB = "syllabus";

/** The mounted navigation, or null when the page has none (the screens then work as before). */
let current = null;

/**
 * Whether a panel has anything to show: some region of it is not hidden.
 *
 * @param {HTMLElement} panel
 * @returns {boolean}
 */
const hasContent = (panel) => [...panel.querySelectorAll("[data-region]")].some((region) => !region.classList.contains("d-none"));

class Navigation {
  /**
   * @param {HTMLElement} root The region of the page.
   */
  constructor(root) {
    this.root = root;
    this.tabs = [...root.querySelectorAll('[role="tab"][data-tab]')];
    this.panels = new Map([...root.querySelectorAll('[role="tabpanel"][data-panel]')].map((panel) => [panel.dataset.panel, panel]));
    this.selected = null;
  }

  tab(name) {
    return this.tabs.find((tab) => tab.dataset.tab === name) ?? null;
  }

  /** Tabs that are on screen, in order. */
  visibleTabs() {
    return this.tabs.filter((tab) => !tab.hidden);
  }

  /**
   * Shows the panel of a tab and marks the tab as selected.
   *
   * @param {string} name
   * @param {{focus?: boolean}} [options] `focus` moves the keyboard focus to the tab.
   */
  select(name, { focus = false } = {}) {
    const target = this.tab(name);
    if (!target || !this.panels.has(name)) {
      return;
    }
    this.selected = name;
    target.hidden = false;
    for (const tab of this.tabs) {
      const active = tab === target;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      this.panels.get(tab.dataset.tab).hidden = !active;
    }
    if (focus) {
      target.focus();
    }
    // A conversation drawn while its panel was hidden could not scroll to the last message.
    for (const log of this.panels.get(name).querySelectorAll('[role="log"]')) {
      log.scrollTop = log.scrollHeight;
    }
  }

  /** Hides the tabs whose panel is empty. The selected tab always stays, so the page never loses its place. */
  refresh() {
    for (const tab of this.tabs) {
      tab.hidden = tab.dataset.tab !== this.selected && !hasContent(this.panels.get(tab.dataset.tab));
    }
  }

  /** Left and right arrows, Home and End move between tabs, as in the ARIA tabs pattern. */
  onKeydown(event) {
    const visible = this.visibleTabs();
    const index = visible.indexOf(document.activeElement);
    if (index === -1) {
      return;
    }
    const next = { ArrowRight: (index + 1) % visible.length, ArrowLeft: (index - 1 + visible.length) % visible.length, Home: 0, End: visible.length - 1 }[event.key];
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    this.select(visible[next].dataset.tab, { focus: true });
  }

  /**
   * @param {string} initial Tab to open first.
   */
  mount(initial) {
    for (const tab of this.tabs) {
      tab.addEventListener("click", () => this.select(tab.dataset.tab));
    }
    this.root.querySelector('[role="tablist"]')?.addEventListener("keydown", (event) => this.onKeydown(event));
    this.select(this.tab(initial) ? initial : DEFAULT_TAB);
    this.refresh();
    // The screens show and hide their regions with `d-none`; watching that class keeps the tabs in step.
    const observer = new MutationObserver(() => this.refresh());
    for (const region of this.root.querySelectorAll("[data-region]")) {
      observer.observe(region, { attributes: true, attributeFilter: ["class"] });
    }
  }
}

/**
 * Shows a tab from another module, for example the proposal after it is generated. It does nothing when the page has
 * no tabs.
 *
 * @param {string} name `syllabus`, `proposal`, `chat`, `analytics`, `mapping` or `admin`.
 */
export const activate = (name) => {
  current?.select(name);
};

/**
 * Entry point called from index.php.
 *
 * @param {{proposalId?: string}} [options] A proposal in the URL opens its tab.
 */
export const init = ({ proposalId = "" } = {}) => {
  const root = document.querySelector('[data-region="local_ai_assistant"]');
  if (!root || !root.querySelector('[role="tablist"]')) {
    return;
  }
  current = new Navigation(root);
  current.mount(proposalId ? "proposal" : DEFAULT_TAB);
};
