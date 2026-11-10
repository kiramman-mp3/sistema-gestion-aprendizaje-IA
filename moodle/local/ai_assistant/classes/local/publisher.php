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

    /** @var string Kind stored in the mapping table for an activity. */
    public const TYPE_MODULE = 'module';

    /** @var string[] Kinds of activity the plugin creates (D-05, provisional). */
    public const MODULES = ['assign', 'forum', 'quiz', 'label', 'page'];

    /** @var string Prefix of the idnumber that marks an activity as created for a proposal item. */
    private const IDNUMBER_PREFIX = 'ai:';

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
        try {
            $section = course_create_section($course);
            course_update_section($course, $section, [
                'name' => self::clean_name($name),
                'summary' => self::as_html($summary),
                'summaryformat' => FORMAT_HTML,
            ]);
            self::save_mapping($courseid, $itemuuid, self::TYPE_SECTION, (int) $section->id);
            $transaction->allow_commit();
        } catch (\Throwable $exception) {
            $transaction->rollback($exception);
        }

        return self::section_result($section, true);
    }

    /**
     * Creates the activity of a proposal item, or returns the one created before for the same item.
     *
     * The activity is created with the teacher's own rights, so Moodle applies what that teacher may do (for
     * example with the calendar), and it is created hidden: the teacher reviews it before students see it.
     *
     * @param int $userid Teacher on whose behalf the backend publishes.
     * @param int $courseid
     * @param string $itemuuid Id of the item in the backend.
     * @param int $sectionid Section (course_sections.id) where the activity goes.
     * @param string $modname One of self::MODULES.
     * @param string $name Activity name.
     * @param string $intro Activity description, plain text.
     * @param string $duedate YYYY-MM-DD, or empty for none.
     * @return array With cmid and created (false when it already existed).
     */
    public static function publish_module(
        int $userid,
        int $courseid,
        string $itemuuid,
        int $sectionid,
        string $modname,
        string $name,
        string $intro,
        string $duedate
    ): array {
        global $DB, $USER;

        self::require_item_uuid($itemuuid);
        if (!in_array($modname, self::MODULES, true)) {
            throw new \invalid_parameter_exception('modname must be one of: ' . implode(', ', self::MODULES));
        }
        $date = self::parse_due_date($duedate);
        $course = self::course_for_teacher(
            $userid,
            $courseid,
            ['moodle/course:manageactivities', "mod/{$modname}:addinstance"]
        );
        $section = $DB->get_record('course_sections', ['id' => $sectionid, 'course' => $courseid]);
        if (!$section) {
            throw new \invalid_parameter_exception('sectionid does not belong to the course');
        }

        $existing = self::existing_module($courseid, $itemuuid);
        if ($existing) {
            return ['cmid' => $existing, 'created' => false];
        }

        $teacher = $DB->get_record('user', ['id' => $userid], '*', MUST_EXIST);
        $info = self::module_info($course, $section, $teacher, $itemuuid, $modname, $name, $intro, $date);

        $transaction = $DB->start_delegated_transaction();
        $integration = $USER;
        try {
            \core\session\manager::set_user($teacher);
            try {
                $created = create_module($info);
            } finally {
                \core\session\manager::set_user($integration);
            }
            self::save_mapping($courseid, $itemuuid, self::TYPE_MODULE, (int) $created->coursemodule);
            $transaction->allow_commit();
        } catch (\Throwable $exception) {
            $transaction->rollback($exception);
        }

        return ['cmid' => (int) $created->coursemodule, 'created' => true];
    }

    /**
     * Finds the activity already created for an item, by the mapping or by its idnumber.
     *
     * The idnumber covers a lost mapping row: the activity still carries the id of its item.
     *
     * @param int $courseid
     * @param string $itemuuid
     * @return int Course module id, or 0 if there is none.
     */
    protected static function existing_module(int $courseid, string $itemuuid): int {
        global $DB;

        $alive = ['course' => $courseid, 'deletioninprogress' => 0];
        $mapping = self::find_mapping($courseid, $itemuuid, self::TYPE_MODULE);
        if ($mapping) {
            if ($DB->record_exists('course_modules', ['id' => $mapping->moodleid] + $alive)) {
                return (int) $mapping->moodleid;
            }
            // The teacher deleted the activity in Moodle: publish it again.
            $DB->delete_records('local_ai_assistant_items', ['id' => $mapping->id]);
        }

        $idnumber = self::IDNUMBER_PREFIX . strtolower($itemuuid);
        $cmid = $DB->get_field('course_modules', 'id', ['idnumber' => $idnumber] + $alive);
        if ($cmid) {
            self::save_mapping($courseid, $itemuuid, self::TYPE_MODULE, (int) $cmid);
            return (int) $cmid;
        }

        return 0;
    }

    /**
     * Reads a YYYY-MM-DD date.
     *
     * @param string $duedate
     * @return int[]|null Year, month and day, or null if there is no date.
     * @throws \invalid_parameter_exception If it is not a real date.
     */
    protected static function parse_due_date(string $duedate): ?array {
        if ($duedate === '') {
            return null;
        }
        $valid = preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $duedate, $parts)
            && checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1]);
        if (!$valid) {
            throw new \invalid_parameter_exception('duedate must be a real date as YYYY-MM-DD');
        }
        return [(int) $parts[1], (int) $parts[2], (int) $parts[3]];
    }

    /**
     * Builds the data Moodle needs to create the activity.
     *
     * @param \stdClass $course
     * @param \stdClass $section Row of course_sections.
     * @param \stdClass $teacher
     * @param string $itemuuid
     * @param string $modname
     * @param string $name
     * @param string $intro
     * @param int[]|null $date Year, month and day of the due date.
     * @return \stdClass
     */
    protected static function module_info(
        \stdClass $course,
        \stdClass $section,
        \stdClass $teacher,
        string $itemuuid,
        string $modname,
        string $name,
        string $intro,
        ?array $date
    ): \stdClass {
        global $DB;

        $name = self::clean_name($name);
        $html = self::as_html($intro);
        // A label has no title of its own: what it shows is its description.
        if ($modname === 'label') {
            $html = '<p><strong>' . s($name) . '</strong></p>' . $html;
        }
        // The end of the due day in the teacher's time zone.
        $due = $date ? make_timestamp($date[0], $date[1], $date[2], 23, 59, 0, \core_date::get_user_timezone($teacher)) : 0;

        $info = new \stdClass();
        $info->modulename = $modname;
        $info->module = $DB->get_field('modules', 'id', ['name' => $modname, 'visible' => 1], MUST_EXIST);
        $info->course = $course->id;
        $info->section = (int) $section->section;
        $info->visible = 0;
        $info->name = $name;
        $info->introeditor = ['text' => $html, 'format' => FORMAT_HTML, 'itemid' => 0];
        $info->showdescription = 0;
        $info->cmidnumber = self::IDNUMBER_PREFIX . strtolower($itemuuid);

        switch ($modname) {
            case 'assign':
                $info->duedate = $due;
                $info->grade = 100;
                $info->assignsubmission_onlinetext_enabled = 1;
                $info->assignsubmission_file_enabled = 1;
                $info->assignsubmission_file_maxfiles = 1;
                $info->assignsubmission_file_maxsizebytes = 0;
                $info->assignfeedback_comments_enabled = 1;
                foreach (
                    [
                        'submissiondrafts', 'requiresubmissionstatement', 'sendnotifications', 'sendlatenotifications',
                        'allowsubmissionsfromdate', 'cutoffdate', 'gradingduedate', 'teamsubmission',
                        'requireallteammemberssubmit', 'blindmarking', 'markingworkflow', 'markingallocation',
                    ] as $setting
                ) {
                    $info->{$setting} = 0;
                }
                break;
            case 'forum':
                $info->type = 'general';
                $info->duedate = $due;
                $info->grade_forum = 0;
                break;
            case 'quiz':
                // Created empty: the teacher adds the questions.
                $info->timeopen = 0;
                $info->timeclose = $due;
                $info->grade = 10;
                $info->decimalpoints = 2;
                $info->questiondecimalpoints = -1;
                $info->quizpassword = '';
                break;
            case 'page':
                // Moodle only reads the editor field when a form submits it; without a form it needs content.
                $info->page = ['text' => $html, 'format' => FORMAT_HTML, 'itemid' => 0];
                $info->content = $html;
                $info->contentformat = FORMAT_HTML;
                $info->display = 5;
                $info->printintro = 0;
                $info->printlastmodified = 1;
                break;
            default:
                // A label needs nothing more.
                break;
        }

        return $info;
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
