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
 * Lists the students of a course with their names, for the analytics screens.
 *
 * The backend identifies students only by their Moodle id. The names are resolved here, in the browser
 * session of the teacher, so they never travel to the backend or to the AI provider (ADR-010). Only a
 * teacher who may view the analytics of the course receives the list.
 *
 * @package    local_ai_assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class get_course_students extends external_api {
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
     * Returns the active students of the course, sorted by name.
     *
     * @param int $courseid
     * @return array
     */
    public static function execute(int $courseid): array {
        ['courseid' => $courseid] = self::validate_parameters(self::execute_parameters(), ['courseid' => $courseid]);

        $context = \context_course::instance($courseid);
        self::validate_context($context);
        require_capability('local/ai_assistant:viewanalytics', $context);

        // Students can submit assignments; teachers cannot. Only active enrolments are listed.
        $fields = \core_user\fields::for_name()->get_sql('u', false, '', '', false)->selects;
        $users = get_enrolled_users($context, 'mod/assign:submit', 0, 'u.id, ' . $fields, 'u.lastname, u.firstname', 0, 0, true);

        $students = [];
        foreach ($users as $user) {
            $students[] = ['id' => (int) $user->id, 'fullname' => fullname($user)];
        }
        usort($students, fn($a, $b) => strcoll($a['fullname'], $b['fullname']));

        return $students;
    }

    /**
     * Return structure.
     *
     * @return external_multiple_structure
     */
    public static function execute_returns(): external_multiple_structure {
        return new external_multiple_structure(
            new external_single_structure([
                'id' => new external_value(PARAM_INT, 'Moodle user id'),
                'fullname' => new external_value(PARAM_TEXT, 'Full name of the student'),
            ])
        );
    }
}
