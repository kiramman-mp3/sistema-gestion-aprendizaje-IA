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

namespace local_ai_assistant\local;

/**
 * Creates the sections and activities of an approved proposal (RF-09, ADR-008).
 *
 * The backend calls it item by item through the external functions of the plugin. Two rules keep it
 * safe to repeat:
 *
 * - Every item carries the id it has in the backend. A table maps that id to what was created, so asking
 *   for the same item again returns the existing section or activity instead of creating a copy, even if
 *   the previous answer was lost.
 * - The teacher in whose name the backend publishes must hold the capabilities needed in the course.
 *   Moodle, not the backend, decides (ADR-007).
 *
 * @package    local_ai_assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class publisher {
    /** @var string Kind stored in the mapping table for a course section. */
    public const TYPE_SECTION = 'section';

    /** @var int Longest name Moodle stores for a section or activity. */
    private const MAX_NAME_LENGTH = 255;

    /**
     * Creates the section of a proposal item, or returns the one created before for the same item.
     *
     * @param int $userid Teacher on whose behalf the backend publishes.
     * @param int $courseid
     * @param string $itemuuid Id of the item in the backend.
     * @param string $name Section name.
     * @param string $summary Section description, plain text.
     * @return array With sectionid, sectionnum and created (false when it already existed).
     */
    public static function publish_section(
        int $userid,
        int $courseid,
        string $itemuuid,
        string $name,
        string $summary
    ): array {
        global $DB;

        self::require_item_uuid($itemuuid);
        $course = self::course_for_teacher($userid, $courseid, ['moodle/course:update']);

        $existing = self::find_mapping($courseid, $itemuuid, self::TYPE_SECTION);
        if ($existing) {
            $section = $DB->get_record('course_sections', ['id' => $existing->moodleid, 'course' => $courseid]);
            if ($section) {
                return self::section_result($section, false);
            }
            // The teacher deleted the section in Moodle: publish it again.
            $DB->delete_records('local_ai_assistant_items', ['id' => $existing->id]);
        }

        $transaction = $DB->start_delegated_transaction();
        $section = course_create_section($course);
        course_update_section($course, $section, [
            'name' => self::clean_name($name),
            'summary' => self::as_html($summary),
            'summaryformat' => FORMAT_HTML,
        ]);
        self::save_mapping($courseid, $itemuuid, self::TYPE_SECTION, (int) $section->id);
        $transaction->allow_commit();

        return self::section_result($section, true);
    }

    /**
     * Checks that the id is a UUID, the format the backend uses for proposal items.
     *
     * @param string $itemuuid
     * @throws \invalid_parameter_exception
     */
    protected static function require_item_uuid(string $itemuuid): void {
        if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $itemuuid)) {
            throw new \invalid_parameter_exception('itemid must be a UUID');
        }
    }

    /**
     * Returns the course after checking that the teacher may publish in it.
     *
     * @param int $userid
     * @param int $courseid
     * @param string[] $capabilities Capabilities required besides local/ai_assistant:publish.
     * @return \stdClass The course.
     * @throws \required_capability_exception If the teacher lacks a capability.
     */
    protected static function course_for_teacher(int $userid, int $courseid, array $capabilities): \stdClass {
        global $DB;

        if (!$DB->record_exists('user', ['id' => $userid, 'deleted' => 0, 'suspended' => 0])) {
            throw new \invalid_parameter_exception('The teacher does not exist or is not active');
        }
        if ($courseid === (int) SITEID) {
            throw new \invalid_parameter_exception('The site front page cannot be published to');
        }
        $course = $DB->get_record('course', ['id' => $courseid], '*', MUST_EXIST);
        $context = \context_course::instance($courseid);
        foreach (array_merge(['local/ai_assistant:publish'], $capabilities) as $capability) {
            if (!has_capability($capability, $context, $userid)) {
                throw new \required_capability_exception($context, $capability, 'nopermissions', '');
            }
        }

        return $course;
    }

    /**
     * Finds what was created for an item.
     *
     * @param int $courseid
     * @param string $itemuuid
     * @param string $itemtype
     * @return \stdClass|false The mapping row, or false.
     */
    protected static function find_mapping(int $courseid, string $itemuuid, string $itemtype) {
        global $DB;

        return $DB->get_record('local_ai_assistant_items', [
            'courseid' => $courseid,
            'itemuuid' => strtolower($itemuuid),
            'itemtype' => $itemtype,
        ]);
    }

    /**
     * Records what was created for an item.
     *
     * @param int $courseid
     * @param string $itemuuid
     * @param string $itemtype
     * @param int $moodleid
     */
    protected static function save_mapping(int $courseid, string $itemuuid, string $itemtype, int $moodleid): void {
        global $DB;

        $DB->insert_record('local_ai_assistant_items', (object) [
            'courseid' => $courseid,
            'itemuuid' => strtolower($itemuuid),
            'itemtype' => $itemtype,
            'moodleid' => $moodleid,
            'timecreated' => time(),
        ]);
    }

    /**
     * Shapes a section for the response.
     *
     * @param \stdClass $section Row of course_sections.
     * @param bool $created
     * @return array
     */
    protected static function section_result(\stdClass $section, bool $created): array {
        return [
            'sectionid' => (int) $section->id,
            'sectionnum' => (int) $section->section,
            'created' => $created,
        ];
    }

    /**
     * Makes a name safe and short enough for Moodle.
     *
     * @param string $name
     * @return string
     */
    protected static function clean_name(string $name): string {
        return \core_text::substr(trim(clean_param($name, PARAM_TEXT)), 0, self::MAX_NAME_LENGTH);
    }

    /**
     * Turns plain text into HTML, escaping it first so nothing typed in a syllabus becomes markup.
     *
     * @param string $text
     * @return string
     */
    protected static function as_html(string $text): string {
        $text = trim($text);
        return $text === '' ? '' : nl2br(s($text), false);
    }
}
