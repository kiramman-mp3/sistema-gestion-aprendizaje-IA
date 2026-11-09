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
use core_external\external_single_structure;
use core_external\external_value;
use local_ai_assistant\local\token_issuer;

/**
 * Returns a short-lived backend token for the current user in a course.
 *
 * Called from the browser through the AJAX service with the user's Moodle session. The signing
 * secret never leaves the server: the browser only receives the signed token.
 *
 * @package    local_ai_assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class get_backend_token extends external_api {
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
     * Issues the token after checking that the user may use the assistant in the course.
     *
     * @param int $courseid
     * @return array
     */
    public static function execute(int $courseid): array {
        global $USER;

        ['courseid' => $courseid] = self::validate_parameters(self::execute_parameters(), ['courseid' => $courseid]);

        $context = \context_course::instance($courseid);
        self::validate_context($context);
        require_capability('local/ai_assistant:use', $context);

        $issued = token_issuer::issue((int) $USER->id, $courseid);

        return [
            'token' => $issued['token'],
            'expiresat' => $issued['expiresat'],
            'backendurl' => (string) get_config('local_ai_assistant', 'backendurl'),
        ];
    }

    /**
     * Return structure.
     *
     * @return external_single_structure
     */
    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'token' => new external_value(PARAM_RAW, 'Signed JWT for the backend'),
            'expiresat' => new external_value(PARAM_INT, 'Expiry timestamp'),
            'backendurl' => new external_value(PARAM_URL, 'Backend API base URL'),
        ]);
    }
}
