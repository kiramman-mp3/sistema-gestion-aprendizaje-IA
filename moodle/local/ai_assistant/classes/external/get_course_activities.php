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

namespace local_ai_assistant\external;

use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_multiple_structure;
use core_external\external_single_structure;
use core_external\external_value;

/**
 * Lists the activities of a course, so the teacher can relate each one to a unit of the syllabus.
 *
 * It runs with the teacher's session: Moodle decides which activities the teacher may see. Labels are left
 * out because they have nothing to grade or analyse.
 *
 * @package    local_ai_assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class get_course_activities extends external_api {
    /**
     * Parameters.
     *
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'courseid' => new external_value(PARAM_INT, 'Course id'),
        ]);
    }

    /**
     * Returns the activities in course order.
     *
     * @param int $courseid
     * @return array
     */
    public static function execute(int $courseid): array {
        global $CFG;

        // A web service request does not load the course library by itself.
        require_once($CFG->dirroot . '/course/lib.php');

        ['courseid' => $courseid] = self::validate_parameters(self::execute_parameters(), ['courseid' => $courseid]);

        $context = \context_course::instance($courseid);
        self::validate_context($context);
        require_capability('local/ai_assistant:use', $context);

        $course = get_course($courseid);
        $modinfo = get_fast_modinfo($course);

        $activities = [];
        foreach ($modinfo->get_cms() as $cm) {
            if ($cm->modname === 'label' || $cm->deletioninprogress || !$cm->uservisible) {
                continue;
            }
            $activities[] = [
                'cmid' => (int) $cm->id,
                'name' => $cm->get_formatted_name(),
                'modname' => $cm->modname,
                'sectionnum' => (int) $cm->sectionnum,
                'sectionname' => get_section_name($course, $cm->sectionnum),
                'visible' => (bool) $cm->visible,
            ];
        }

        return $activities;
    }

    /**
     * Return structure.
     *
     * @return external_multiple_structure
     */
    public static function execute_returns(): external_multiple_structure {
        return new external_multiple_structure(
            new external_single_structure([
                'cmid' => new external_value(PARAM_INT, 'Course module id'),
                'name' => new external_value(PARAM_TEXT, 'Name of the activity'),
                'modname' => new external_value(PARAM_ALPHANUMEXT, 'Kind of activity, for example assign'),
                'sectionnum' => new external_value(PARAM_INT, 'Position of the section in the course'),
                'sectionname' => new external_value(PARAM_TEXT, 'Name of the section'),
                'visible' => new external_value(PARAM_BOOL, 'Whether students can see it'),
            ])
        );
    }
}
