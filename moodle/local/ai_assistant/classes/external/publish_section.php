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
 * Creates the section of a proposal item (RF-09, ADR-008).
 *
 * Only the integration user calls this function. It validates the parameters and that the teacher in
 * whose name it publishes holds the capabilities in the course; the work is done by the publisher.
 *
 * @package    local_ai_assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class publish_section extends external_api {
    /**
     * Parameters.
     *
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'userid' => new external_value(PARAM_INT, 'Teacher on whose behalf the section is created'),
            'courseid' => new external_value(PARAM_INT, 'Course id'),
            'itemid' => new external_value(PARAM_ALPHANUMEXT, 'Id of the proposal item (UUID)'),
            // Raw on purpose: text from a syllabus may contain < or &. The publisher cleans and escapes it, so
            // one odd character does not make the whole publication fail.
            'name' => new external_value(PARAM_RAW, 'Section name'),
            'summary' => new external_value(PARAM_RAW, 'Section description, plain text', VALUE_DEFAULT, ''),
        ]);
    }

    /**
     * Creates the section, or returns the one created before for the same item.
     *
     * @param int $userid
     * @param int $courseid
     * @param string $itemid
     * @param string $name
     * @param string $summary
     * @return array
     */
    public static function execute(int $userid, int $courseid, string $itemid, string $name, string $summary = ''): array {
        $params = self::validate_parameters(self::execute_parameters(), [
            'userid' => $userid,
            'courseid' => $courseid,
            'itemid' => $itemid,
            'name' => $name,
            'summary' => $summary,
        ]);

        $systemcontext = \context_system::instance();
        self::validate_context($systemcontext);
        require_capability('local/ai_assistant:createcontent', $systemcontext);

        return publisher::publish_section(
            $params['userid'],
            $params['courseid'],
            $params['itemid'],
            $params['name'],
            $params['summary']
        );
    }

    /**
     * Return structure.
     *
     * @return external_single_structure
     */
    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'sectionid' => new external_value(PARAM_INT, 'Id of the section (course_sections.id)'),
            'sectionnum' => new external_value(PARAM_INT, 'Position of the section in the course'),
            'created' => new external_value(PARAM_BOOL, 'False if the section already existed for this item'),
        ]);
    }
}
