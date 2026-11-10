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
use local_ai_assistant\local\publisher;

/**
 * Creates the activity of a proposal item inside a section (RF-09, ADR-008).
 *
 * Only the integration user calls this function. It validates the parameters and that the teacher in
 * whose name it publishes holds the capabilities in the course; the work is done by the publisher.
 *
 * @package    local_ai_assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class publish_module extends external_api {
    /**
     * Parameters.
     *
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'userid' => new external_value(PARAM_INT, 'Teacher on whose behalf the activity is created'),
            'courseid' => new external_value(PARAM_INT, 'Course id'),
            'itemid' => new external_value(PARAM_ALPHANUMEXT, 'Id of the proposal item (UUID)'),
            'sectionid' => new external_value(PARAM_INT, 'Section of the course where it is created (course_sections.id)'),
            'modname' => new external_value(PARAM_ALPHA, 'Kind of activity: ' . implode(', ', publisher::MODULES)),
            // Raw on purpose: text from a syllabus may contain < or &. The publisher cleans and escapes it.
            'name' => new external_value(PARAM_RAW, 'Activity name'),
            'intro' => new external_value(PARAM_RAW, 'Activity description, plain text', VALUE_DEFAULT, ''),
            'duedate' => new external_value(PARAM_RAW, 'Due date as YYYY-MM-DD, or empty for none', VALUE_DEFAULT, ''),
        ]);
    }

    /**
     * Creates the activity, or returns the one created before for the same item.
     *
     * @param int $userid
     * @param int $courseid
     * @param string $itemid
     * @param int $sectionid
     * @param string $modname
     * @param string $name
     * @param string $intro
     * @param string $duedate
     * @return array
     */
    public static function execute(
        int $userid,
        int $courseid,
        string $itemid,
        int $sectionid,
        string $modname,
        string $name,
        string $intro = '',
        string $duedate = ''
    ): array {
        $params = self::validate_parameters(self::execute_parameters(), [
            'userid' => $userid,
            'courseid' => $courseid,
            'itemid' => $itemid,
            'sectionid' => $sectionid,
            'modname' => $modname,
            'name' => $name,
            'intro' => $intro,
            'duedate' => $duedate,
        ]);

        $systemcontext = \context_system::instance();
        self::validate_context($systemcontext);
        require_capability('local/ai_assistant:createcontent', $systemcontext);

        return publisher::publish_module(
            $params['userid'],
            $params['courseid'],
            $params['itemid'],
            $params['sectionid'],
            $params['modname'],
            $params['name'],
            $params['intro'],
            $params['duedate']
        );
    }

    /**
     * Return structure.
     *
     * @return external_single_structure
     */
    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'cmid' => new external_value(PARAM_INT, 'Id of the course module'),
            'created' => new external_value(PARAM_BOOL, 'False if the activity already existed for this item'),
        ]);
    }
}
