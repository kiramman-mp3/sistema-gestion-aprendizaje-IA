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
 * Assistant page for a course.
 *
 * @package    local_ai_assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require(__DIR__ . '/../../config.php');

$courseid = required_param('courseid', PARAM_INT);
$syllabusid = optional_param('syllabusid', '', PARAM_ALPHANUMEXT);
$proposalid = optional_param('proposalid', '', PARAM_ALPHANUMEXT);
$course = get_course($courseid);
require_login($course);

$context = context_course::instance($course->id);
require_capability('local/ai_assistant:use', $context);

$url = new moodle_url('/local/ai_assistant/index.php', ['courseid' => $course->id]);
$PAGE->set_url($url);
$PAGE->set_context($context);
$PAGE->set_pagelayout('incourse');
$PAGE->set_title(get_string('assistant', 'local_ai_assistant') . ': ' . format_string($course->shortname));
$PAGE->set_heading(format_string($course->fullname));

$PAGE->requires->js_call_amd('local_ai_assistant/assistant', 'init', [(int) $course->id]);
$PAGE->requires->js_call_amd('local_ai_assistant/syllabus', 'init', [(int) $course->id, $syllabusid]);
$PAGE->requires->js_call_amd('local_ai_assistant/proposal_preview', 'init', [(int) $course->id, $proposalid]);
$PAGE->requires->js_call_amd('local_ai_assistant/chat', 'init', [(int) $course->id]);
$PAGE->requires->js_call_amd('local_ai_assistant/analytics', 'init', [(int) $course->id]);
$PAGE->requires->js_call_amd('local_ai_assistant/mapping', 'init', [(int) $course->id]);
$PAGE->requires->js_call_amd('local_ai_assistant/admin', 'init', [(int) $course->id]);

echo $OUTPUT->header();
echo $OUTPUT->render_from_template('local_ai_assistant/assistant', [
    'courseid' => $course->id,
    'backendconfigured' => !empty(get_config('local_ai_assistant', 'backendurl')),
]);
echo $OUTPUT->footer();
