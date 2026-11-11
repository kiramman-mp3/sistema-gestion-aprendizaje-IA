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
use local_ai_assistant\local\reader;

/**
 * Read-only functions the backend calls to get the academic data of a course (ADR-017).
 *
 * Only the integration user calls them, with local/ai_assistant:readdata. Each one receives the teacher on whose
 * behalf it reads and the reader checks that the teacher may view the analytics of the course. They return ids and
 * values, never names, emails or identity numbers.
 *
 * @package    local_ai_assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class read extends external_api {
    /**
     * Checks the call comes from the integration user and the parameters are valid.
     *
     * @param external_function_parameters $definition
     * @param array $values
     * @return array Validated parameters.
     */
    protected static function check(external_function_parameters $definition, array $values): array {
        $params = self::validate_parameters($definition, $values);
        $systemcontext = \context_system::instance();
        self::validate_context($systemcontext);
        require_capability('local/ai_assistant:readdata', $systemcontext);
        return $params;
    }

    /**
     * Parameters shared by every function.
     *
     * @param array $extra More parameters.
     * @return external_function_parameters
     */
    protected static function parameters(array $extra = []): external_function_parameters {
        return new external_function_parameters([
            'userid' => new external_value(PARAM_INT, 'Teacher on whose behalf the data is read'),
            'courseid' => new external_value(PARAM_INT, 'Course id'),
        ] + $extra);
    }

    /**
     * Return structure of a list.
     *
     * @param string $name Name of the list.
     * @param array $fields Fields of each row.
     * @param array $extra More fields of the response.
     * @return external_single_structure
     */
    protected static function listing(string $name, array $fields, array $extra = []): external_single_structure {
        return new external_single_structure([
            'truncated' => new external_value(PARAM_BOOL, 'Whether more rows exist than the ones returned'),
        ] + $extra + [
            $name => new external_multiple_structure(new external_single_structure($fields)),
        ]);
    }

    /**
     * Definition of an id.
     *
     * @param string $description
     * @return external_value
     */
    protected static function id(string $description): external_value {
        return new external_value(PARAM_INT, $description);
    }

    /**
     * Definition of an ISO-8601 date that may be missing.
     *
     * @param string $description
     * @return external_value
     */
    protected static function date(string $description): external_value {
        return new external_value(PARAM_RAW, $description . ' (ISO-8601 UTC)', VALUE_REQUIRED, null, NULL_ALLOWED);
    }

    /**
     * Parameters of list_activities.
     *
     * @return external_function_parameters
     */
    public static function list_activities_parameters(): external_function_parameters {
        return self::parameters();
    }

    /**
     * Activities of the course in order.
     *
     * @param int $userid
     * @param int $courseid
     * @return array
     */
    public static function list_activities(int $userid, int $courseid): array {
        $p = self::check(self::list_activities_parameters(), ['userid' => $userid, 'courseid' => $courseid]);
        return reader::list_activities($p['userid'], $p['courseid']);
    }

    /**
     * Return structure of list_activities.
     *
     * @return external_single_structure
     */
    public static function list_activities_returns(): external_single_structure {
        return self::listing('activities', [
            'cmid' => self::id('Course module id'),
            'modname' => new external_value(PARAM_ALPHANUMEXT, 'Kind of activity, for example assign'),
            'name' => new external_value(PARAM_TEXT, 'Name of the activity'),
            'sectionnum' => new external_value(PARAM_INT, 'Position of the section in the course'),
            'visible' => new external_value(PARAM_BOOL, 'Whether students can see it'),
            'duedate' => self::date('Due date'),
            'maxgrade' => new external_value(PARAM_FLOAT, 'Maximum grade', VALUE_REQUIRED, null, NULL_ALLOWED),
        ]);
    }

    /**
     * Parameters of list_students.
     *
     * @return external_function_parameters
     */
    public static function list_students_parameters(): external_function_parameters {
        return self::parameters();
    }

    /**
     * Ids of the active students of the course.
     *
     * @param int $userid
     * @param int $courseid
     * @return array
     */
    public static function list_students(int $userid, int $courseid): array {
        $p = self::check(self::list_students_parameters(), ['userid' => $userid, 'courseid' => $courseid]);
        return reader::list_students($p['userid'], $p['courseid']);
    }

    /**
     * Return structure of list_students.
     *
     * @return external_single_structure
     */
    public static function list_students_returns(): external_single_structure {
        return self::listing('students', ['studentid' => self::id('Student id')]);
    }

    /**
     * Parameters of get_submissions.
     *
     * @return external_function_parameters
     */
    public static function get_submissions_parameters(): external_function_parameters {
        return self::parameters(['cmid' => self::id('Course module id of the assignment')]);
    }

    /**
     * Submissions of an assignment.
     *
     * @param int $userid
     * @param int $courseid
     * @param int $cmid
     * @return array
     */
    public static function get_submissions(int $userid, int $courseid, int $cmid): array {
        $p = self::check(
            self::get_submissions_parameters(),
            ['userid' => $userid, 'courseid' => $courseid, 'cmid' => $cmid]
        );
        return reader::get_submissions($p['userid'], $p['courseid'], $p['cmid']);
    }

    /**
     * Return structure of get_submissions.
     *
     * @return external_single_structure
     */
    public static function get_submissions_returns(): external_single_structure {
        return self::listing('submissions', [
            'studentid' => self::id('Student id'),
            'status' => new external_value(PARAM_ALPHA, 'new, draft, submitted, graded or missing'),
            'submittedat' => self::date('Date of the submission'),
            'late' => new external_value(PARAM_BOOL, 'Whether it was submitted after the due date'),
        ], ['cmid' => self::id('Course module id')]);
    }

    /**
     * Parameters of get_pending_grading.
     *
     * @return external_function_parameters
     */
    public static function get_pending_grading_parameters(): external_function_parameters {
        return self::parameters(['cmid' => new external_value(PARAM_INT, 'Assignment, or 0 for all', VALUE_DEFAULT, 0)]);
    }

    /**
     * Submissions waiting for a grade.
     *
     * @param int $userid
     * @param int $courseid
     * @param int $cmid
     * @return array
     */
    public static function get_pending_grading(int $userid, int $courseid, int $cmid = 0): array {
        $p = self::check(
            self::get_pending_grading_parameters(),
            ['userid' => $userid, 'courseid' => $courseid, 'cmid' => $cmid]
        );
        return reader::get_pending_grading($p['userid'], $p['courseid'], $p['cmid'] ?: null);
    }

    /**
     * Return structure of get_pending_grading.
     *
     * @return external_single_structure
     */
    public static function get_pending_grading_returns(): external_single_structure {
        return self::listing('pending', [
            'cmid' => self::id('Course module id'),
            'studentid' => self::id('Student id'),
            'submittedat' => self::date('Date of the submission'),
        ]);
    }

    /**
     * Parameters of get_grades.
     *
     * @return external_function_parameters
     */
    public static function get_grades_parameters(): external_function_parameters {
        return self::parameters(['cmid' => new external_value(PARAM_INT, 'Activity, or 0 for all', VALUE_DEFAULT, 0)]);
    }

    /**
     * Visible grades.
     *
     * @param int $userid
     * @param int $courseid
     * @param int $cmid
     * @return array
     */
    public static function get_grades(int $userid, int $courseid, int $cmid = 0): array {
        $p = self::check(self::get_grades_parameters(), ['userid' => $userid, 'courseid' => $courseid, 'cmid' => $cmid]);
        return reader::get_grades($p['userid'], $p['courseid'], $p['cmid'] ?: null);
    }

    /**
     * Return structure of get_grades.
     *
     * @return external_single_structure
     */
    public static function get_grades_returns(): external_single_structure {
        return self::listing('grades', [
            'cmid' => self::id('Course module id'),
            'studentid' => self::id('Student id'),
            'grade' => new external_value(PARAM_FLOAT, 'Grade', VALUE_REQUIRED, null, NULL_ALLOWED),
            'grademax' => new external_value(PARAM_FLOAT, 'Maximum grade', VALUE_REQUIRED, null, NULL_ALLOWED),
            'gradedat' => self::date('Date of the grade'),
        ]);
    }

    /**
     * Parameters of get_completion.
     *
     * @return external_function_parameters
     */
    public static function get_completion_parameters(): external_function_parameters {
        return self::parameters();
    }

    /**
     * Completion of the activities.
     *
     * @param int $userid
     * @param int $courseid
     * @return array
     */
    public static function get_completion(int $userid, int $courseid): array {
        $p = self::check(self::get_completion_parameters(), ['userid' => $userid, 'courseid' => $courseid]);
        return reader::get_completion($p['userid'], $p['courseid']);
    }

    /**
     * Return structure of get_completion.
     *
     * @return external_single_structure
     */
    public static function get_completion_returns(): external_single_structure {
        return self::listing('completion', [
            'cmid' => self::id('Course module id'),
            'studentid' => self::id('Student id'),
            'completed' => new external_value(PARAM_BOOL, 'Whether the student completed the activity'),
            'completedat' => self::date('Date of completion'),
        ]);
    }

    /**
     * Parameters of get_last_access.
     *
     * @return external_function_parameters
     */
    public static function get_last_access_parameters(): external_function_parameters {
        return self::parameters();
    }

    /**
     * Last access of every student.
     *
     * @param int $userid
     * @param int $courseid
     * @return array
     */
    public static function get_last_access(int $userid, int $courseid): array {
        $p = self::check(self::get_last_access_parameters(), ['userid' => $userid, 'courseid' => $courseid]);
        return reader::get_last_access($p['userid'], $p['courseid']);
    }

    /**
     * Return structure of get_last_access.
     *
     * @return external_single_structure
     */
    public static function get_last_access_returns(): external_single_structure {
        return self::listing('lastaccess', [
            'studentid' => self::id('Student id'),
            'lastaccess' => self::date('Last access to the course'),
        ]);
    }
}
