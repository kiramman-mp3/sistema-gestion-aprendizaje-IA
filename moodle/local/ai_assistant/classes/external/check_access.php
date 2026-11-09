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
 * Tells the backend what a user may do with the assistant in a course (ADR-007).
 *
 * Only the integration user calls this function. Moodle stays the single source of truth for
 * permissions: the backend never replicates roles.
 *
 * @package    local_ai_assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class check_access extends external_api {
    /** Assistant capabilities reported to the backend, keyed by the name used in the response. */
    private const CAPABILITIES = [
        'use' => 'local/ai_assistant:use',
        'publish' => 'local/ai_assistant:publish',
        'viewanalytics' => 'local/ai_assistant:viewanalytics',
    ];

    /**
     * Parameters.
     *
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'userid' => new external_value(PARAM_INT, 'Moodle user id'),
            'courseid' => new external_value(PARAM_INT, 'Course id'),
        ]);
    }

    /**
     * Reports the user's assistant capabilities in the course. Everything is false when the course
     * does not exist, is the front page, or the user is missing, deleted or suspended.
     *
     * @param int $userid
     * @param int $courseid
     * @return array
     */
    public static function execute(int $userid, int $courseid): array {
        global $DB;

        ['userid' => $userid, 'courseid' => $courseid] = self::validate_parameters(
            self::execute_parameters(),
            ['userid' => $userid, 'courseid' => $courseid]
        );

        $systemcontext = \context_system::instance();
        self::validate_context($systemcontext);
        require_capability('local/ai_assistant:checkaccess', $systemcontext);

        $result = [
            'userid' => $userid,
            'courseid' => $courseid,
            'courseexists' => false,
            'active' => false,
            'roles' => [],
            'capabilities' => array_fill_keys(array_keys(self::CAPABILITIES), false),
        ];

        $user = $DB->get_record('user', ['id' => $userid, 'deleted' => 0], 'id, suspended');
        $result['active'] = $user && !$user->suspended;

        if ($courseid === (int) SITEID || !$DB->record_exists('course', ['id' => $courseid])) {
            return $result;
        }
        $result['courseexists'] = true;

        if (!$result['active']) {
            return $result;
        }

        $context = \context_course::instance($courseid);
        $result['roles'] = array_values(array_unique(array_map(
            fn($role) => $role->shortname,
            get_user_roles($context, $userid)
        )));
        foreach (self::CAPABILITIES as $key => $capability) {
            $result['capabilities'][$key] = has_capability($capability, $context, $userid);
        }

        return $result;
    }

    /**
     * Return structure.
     *
     * @return external_single_structure
     */
    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'userid' => new external_value(PARAM_INT, 'Moodle user id'),
            'courseid' => new external_value(PARAM_INT, 'Course id'),
            'courseexists' => new external_value(PARAM_BOOL, 'Whether the course exists'),
            'active' => new external_value(PARAM_BOOL, 'Whether the user exists and is not suspended'),
            'roles' => new external_multiple_structure(
                new external_value(PARAM_ALPHANUMEXT, 'Role short name in the course context')
            ),
            'capabilities' => new external_single_structure([
                'use' => new external_value(PARAM_BOOL, 'local/ai_assistant:use'),
                'publish' => new external_value(PARAM_BOOL, 'local/ai_assistant:publish'),
                'viewanalytics' => new external_value(PARAM_BOOL, 'local/ai_assistant:viewanalytics'),
            ]),
        ]);
    }
}
