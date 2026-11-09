<?php
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
 * Library callbacks for local_ai_assistant.
 *
 * @package    local_ai_assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/**
 * Adds the assistant to the course navigation for users who may use it.
 *
 * @param navigation_node $navigation Course navigation node.
 * @param stdClass $course Course.
 * @param context_course $context Course context.
 */
function local_ai_assistant_extend_navigation_course(navigation_node $navigation, stdClass $course, context_course $context): void {
    if ((int) $course->id === (int) SITEID || !has_capability('local/ai_assistant:use', $context)) {
        return;
    }
    $navigation->add(
        get_string('assistant', 'local_ai_assistant'),
        new moodle_url('/local/ai_assistant/index.php', ['courseid' => $course->id]),
        navigation_node::TYPE_SETTING,
        null,
        'local_ai_assistant',
        new pix_icon('i/report', '')
    );
}
