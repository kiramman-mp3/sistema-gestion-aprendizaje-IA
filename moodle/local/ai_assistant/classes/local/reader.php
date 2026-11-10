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
 * Reads the academic data the assistant needs (activities, submissions, grades, completion, last access).
 *
 * The backend calls it through the external functions of the plugin, with the integration user and on behalf
 * of a teacher. Rules that hold for every read (ADR-010, ADR-017):
 *
 * - Only ids: never names, emails or identity numbers.
 * - Moodle decides who may read: the teacher must hold local/ai_assistant:viewanalytics in the course. Separate
 *   groups are respected, and hidden grades are not returned.
 * - Dates are ISO-8601 UTC, a missing grade is null (never 0), and a list is cut at MAX_ROWS with truncated.
 *
 * @package    local_ai_assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class reader {
    /** @var int Most rows one call returns; past it the response says truncated. */
    public const MAX_ROWS = 500;

    /**
     * Checks that the teacher may read the course and returns the course and its context.
     *
     * @param int $userid Teacher on whose behalf the data is read.
     * @param int $courseid
     * @return array [\stdClass course, \context_course context]
     * @throws \required_capability_exception If the teacher may not view the analytics of the course.
     */
    public static function authorize(int $userid, int $courseid): array {
        global $CFG, $DB;

        // A web service request does not load these libraries by itself (PHPUnit and CLI do).
        require_once($CFG->dirroot . '/course/lib.php');
        require_once($CFG->dirroot . '/group/lib.php');
        require_once($CFG->libdir . '/gradelib.php');

        if (!$DB->record_exists('user', ['id' => $userid, 'deleted' => 0, 'suspended' => 0])) {
            throw new \invalid_parameter_exception('The teacher does not exist or is not active');
        }
        if ($courseid === (int) SITEID) {
            throw new \invalid_parameter_exception('The site front page has no course data');
        }
        $course = $DB->get_record('course', ['id' => $courseid], '*', MUST_EXIST);
        $context = \context_course::instance($courseid);
        if (!has_capability('local/ai_assistant:viewanalytics', $context, $userid)) {
            throw new \required_capability_exception($context, 'local/ai_assistant:viewanalytics', 'nopermissions', '');
        }

        return [$course, $context];
    }

    /**
     * Formats a timestamp as ISO-8601 UTC.
     *
     * @param int|string|null $timestamp
     * @return string|null Null when there is no date.
     */
    public static function iso($timestamp): ?string {
        return empty($timestamp) ? null : gmdate('Y-m-d\TH:i:s\Z', (int) $timestamp);
    }

    /**
     * Cuts a list at MAX_ROWS.
     *
     * @param array $rows Up to MAX_ROWS + 1 rows.
     * @return array [array rows, bool truncated]
     */
    public static function cut(array $rows): array {
        $truncated = count($rows) > self::MAX_ROWS;
        return [array_slice(array_values($rows), 0, self::MAX_ROWS), $truncated];
    }

    /**
     * Ids of the active students the teacher may see, sorted.
     *
     * Students are those who can submit assignments; teachers cannot. With separate groups, a teacher who may
     * not access all groups only sees the members of their own groups.
     *
     * @param \stdClass $course
     * @param \context_course $context
     * @param int $userid Teacher.
     * @param \cm_info|null $cm Activity whose group mode applies; the course mode when null.
     * @return int[]
     */
    public static function student_ids(\stdClass $course, \context_course $context, int $userid, ?\cm_info $cm = null): array {
        $users = get_enrolled_users($context, 'mod/assign:submit', 0, 'u.id', 'u.id', 0, 0, true);
        $ids = array_map('intval', array_keys($users));

        $mode = $cm ? groups_get_activity_groupmode($cm, $course) : (int) $course->groupmode;
        if ($mode == SEPARATEGROUPS && !has_capability('moodle/site:accessallgroups', $context, $userid)) {
            $allowed = [];
            foreach (array_keys(groups_get_all_groups($course->id, $userid, 0, 'g.id')) as $groupid) {
                foreach (groups_get_members($groupid, 'u.id') as $member) {
                    $allowed[(int) $member->id] = true;
                }
            }
            $ids = array_values(array_filter($ids, fn($id) => isset($allowed[$id])));
        }

        sort($ids);
        return $ids;
    }

    /**
     * Returns an activity of the course that the teacher can see, or fails.
     *
     * @param \stdClass $course
     * @param int $userid Teacher.
     * @param int $cmid
     * @param string|null $modname Required kind of activity, or null for any.
     * @return \cm_info
     */
    public static function activity(\stdClass $course, int $userid, int $cmid, ?string $modname = null): \cm_info {
        $cm = get_fast_modinfo($course, $userid)->cms[$cmid] ?? null;
        if (!$cm || $cm->deletioninprogress || !$cm->uservisible) {
            throw new \invalid_parameter_exception('cmid does not belong to the course');
        }
        if ($modname !== null && $cm->modname !== $modname) {
            throw new \invalid_parameter_exception("cmid must be an activity of type {$modname}");
        }
        return $cm;
    }

    /**
     * Activities of the course in order, as the teacher sees them.
     *
     * @param int $userid
     * @param int $courseid
     * @return array
     */
    public static function list_activities(int $userid, int $courseid): array {
        global $DB;

        [$course] = self::authorize($userid, $courseid);
        $cms = [];
        foreach (get_fast_modinfo($course, $userid)->get_cms() as $cm) {
            if (!$cm->deletioninprogress && $cm->uservisible) {
                $cms[] = $cm;
            }
        }

        // Due date of the kinds of activity that have one, and the maximum grade of the graded ones.
        $due = [];
        foreach (['assign' => 'duedate', 'forum' => 'duedate', 'quiz' => 'timeclose'] as $table => $field) {
            foreach ($DB->get_records($table, ['course' => $courseid], '', "id, {$field} AS due") as $row) {
                $due[$table][(int) $row->id] = (int) $row->due;
            }
        }
        $max = [];
        $items = $DB->get_records('grade_items', ['courseid' => $courseid, 'itemtype' => 'mod', 'itemnumber' => 0]);
        foreach ($items as $item) {
            if ((int) $item->gradetype === GRADE_TYPE_VALUE) {
                $max[$item->itemmodule][(int) $item->iteminstance] = (float) $item->grademax;
            }
        }

        $rows = [];
        foreach ($cms as $cm) {
            $rows[] = [
                'cmid' => (int) $cm->id,
                'modname' => $cm->modname,
                'name' => $cm->get_formatted_name(),
                'sectionnum' => (int) $cm->sectionnum,
                'visible' => (bool) $cm->visible,
                'duedate' => self::iso($due[$cm->modname][(int) $cm->instance] ?? null),
                'maxgrade' => $max[$cm->modname][(int) $cm->instance] ?? null,
            ];
        }
        [$rows, $truncated] = self::cut(array_slice($rows, 0, self::MAX_ROWS + 1));

        return ['truncated' => $truncated, 'activities' => $rows];
    }

    /**
     * Ids of the active students of the course.
     *
     * @param int $userid
     * @param int $courseid
     * @return array
     */
    public static function list_students(int $userid, int $courseid): array {
        [$course, $context] = self::authorize($userid, $courseid);
        $ids = self::student_ids($course, $context, $userid);
        [$ids, $truncated] = self::cut(array_slice($ids, 0, self::MAX_ROWS + 1));

        return ['truncated' => $truncated, 'students' => array_map(fn($id) => ['studentid' => $id], $ids)];
    }

    /**
     * State of the submission of every student in an assignment.
     *
     * - new: nothing submitted and not overdue (or no due date).
     * - missing: nothing submitted and the due date has passed.
     * - draft: saved but not submitted.
     * - submitted: submitted, not graded yet.
     * - graded: submitted and graded.
     *
     * @param int $userid
     * @param int $courseid
     * @param int $cmid
     * @return array
     */
    public static function get_submissions(int $userid, int $courseid, int $cmid): array {
        global $DB;

        [$course, $context] = self::authorize($userid, $courseid);
        $cm = self::activity($course, $userid, $cmid, 'assign');
        $assign = $DB->get_record('assign', ['id' => $cm->instance], 'id, duedate', MUST_EXIST);
        $students = self::student_ids($course, $context, $userid, $cm);

        $rows = [];
        if ($students) {
            [$insql, $params] = $DB->get_in_or_equal($students, SQL_PARAMS_NAMED);
            $sql = "SELECT s.userid, s.status, s.timemodified, g.grade
                      FROM {assign_submission} s
                 LEFT JOIN {assign_grades} g
                        ON g.assignment = s.assignment AND g.userid = s.userid AND g.attemptnumber = s.attemptnumber
                     WHERE s.assignment = :assignment AND s.latest = 1 AND s.userid {$insql}";
            $found = $DB->get_records_sql($sql, ['assignment' => $assign->id] + $params);
            $byuser = [];
            foreach ($found as $row) {
                $byuser[(int) $row->userid] = $row;
            }
            $due = (int) $assign->duedate;
            foreach ($students as $studentid) {
                $rows[] = self::submission_row($studentid, $byuser[$studentid] ?? null, $due);
            }
        }
        [$rows, $truncated] = self::cut(array_slice($rows, 0, self::MAX_ROWS + 1));

        return ['cmid' => (int) $cmid, 'truncated' => $truncated, 'submissions' => $rows];
    }

    /**
     * Builds the row of one student.
     *
     * @param int $studentid
     * @param \stdClass|null $submission Row with status, timemodified and grade, or null if none.
     * @param int $due Due date as a timestamp, 0 for none.
     * @return array
     */
    protected static function submission_row(int $studentid, ?\stdClass $submission, int $due): array {
        $status = $submission->status ?? 'new';
        $sent = in_array($status, ['submitted', 'reopened'], true);
        if (!$submission || $status === 'new' || $status === 'reopened') {
            // A reopened attempt that was never sent again is not a delivery either.
            $sent = false;
        }
        if ($sent) {
            $graded = $submission->grade !== null && (float) $submission->grade >= 0;
            return [
                'studentid' => $studentid,
                'status' => $graded ? 'graded' : 'submitted',
                'submittedat' => self::iso($submission->timemodified),
                'late' => $due > 0 && (int) $submission->timemodified > $due,
            ];
        }
        if ($status === 'draft') {
            return ['studentid' => $studentid, 'status' => 'draft', 'submittedat' => null, 'late' => false];
        }
        $overdue = $due > 0 && $due < time();
        return ['studentid' => $studentid, 'status' => $overdue ? 'missing' : 'new', 'submittedat' => null, 'late' => false];
    }

    /**
     * Submissions sent and not graded yet, in one assignment or in all of them.
     *
     * @param int $userid
     * @param int $courseid
     * @param int|null $cmid
     * @return array
     */
    public static function get_pending_grading(int $userid, int $courseid, ?int $cmid = null): array {
        global $DB;

        [$course, $context] = self::authorize($userid, $courseid);
        $cms = [];
        foreach (get_fast_modinfo($course, $userid)->get_instances_of('assign') as $cm) {
            if (!$cm->deletioninprogress && $cm->uservisible && ($cmid === null || (int) $cm->id === $cmid)) {
                $cms[] = $cm;
            }
        }
        if ($cmid !== null && !$cms) {
            // Fails with the same error as the other functions when the activity is not an assignment of the course.
            self::activity($course, $userid, $cmid, 'assign');
        }

        $rows = [];
        foreach ($cms as $cm) {
            $students = self::student_ids($course, $context, $userid, $cm);
            if (!$students) {
                continue;
            }
            [$insql, $params] = $DB->get_in_or_equal($students, SQL_PARAMS_NAMED);
            $sql = "SELECT s.userid, s.timemodified
                      FROM {assign_submission} s
                 LEFT JOIN {assign_grades} g
                        ON g.assignment = s.assignment AND g.userid = s.userid AND g.attemptnumber = s.attemptnumber
                     WHERE s.assignment = :assignment AND s.latest = 1 AND s.status = 'submitted' AND s.userid {$insql}
                       AND (g.id IS NULL OR g.grade IS NULL OR g.grade < 0)
                  ORDER BY s.userid";
            foreach ($DB->get_records_sql($sql, ['assignment' => $cm->instance] + $params) as $row) {
                $rows[] = [
                    'cmid' => (int) $cm->id,
                    'studentid' => (int) $row->userid,
                    'submittedat' => self::iso($row->timemodified),
                ];
            }
            if (count($rows) > self::MAX_ROWS) {
                break;
            }
        }
        [$rows, $truncated] = self::cut($rows);

        return ['truncated' => $truncated, 'pending' => $rows];
    }

    /**
     * Grades of the activities of the course, in one activity or in all of them.
     *
     * A student with no grade row is not listed: absent means no grade. A grade that is hidden (the item or the
     * grade itself) is not returned.
     *
     * @param int $userid
     * @param int $courseid
     * @param int|null $cmid
     * @return array
     */
    public static function get_grades(int $userid, int $courseid, ?int $cmid = null): array {
        global $DB;

        [$course, $context] = self::authorize($userid, $courseid);
        $cm = $cmid === null ? null : self::activity($course, $userid, $cmid);

        $now = time();
        $params = ['courseid' => $courseid, 'itemnow' => $now, 'gradenow' => $now];
        // Hidden is 0 (visible), 1 (hidden) or a timestamp (hidden until then).
        $where = "gi.courseid = :courseid AND gi.itemtype = 'mod' AND gi.itemnumber = 0 AND gg.finalgrade IS NOT NULL
                  AND (gi.hidden = 0 OR (gi.hidden > 1 AND gi.hidden <= :itemnow))
                  AND (gg.hidden = 0 OR (gg.hidden > 1 AND gg.hidden <= :gradenow))";
        if ($cm) {
            $where .= ' AND gi.itemmodule = :modname AND gi.iteminstance = :instance';
            $params += ['modname' => $cm->modname, 'instance' => $cm->instance];
        }
        $sql = "SELECT gg.id, gi.itemmodule, gi.iteminstance, gg.userid, gg.finalgrade, gi.grademax, gg.timemodified
                  FROM {grade_grades} gg
                  JOIN {grade_items} gi ON gi.id = gg.itemid
                 WHERE {$where}
              ORDER BY gi.iteminstance, gg.userid";

        $students = array_flip(self::student_ids($course, $context, $userid));
        $modinfo = get_fast_modinfo($course, $userid);
        $rows = [];
        foreach ($DB->get_recordset_sql($sql, $params) as $row) {
            $activity = self::cm_of($modinfo, $row->itemmodule, (int) $row->iteminstance);
            if (!$activity || !isset($students[(int) $row->userid])) {
                continue;
            }
            $rows[] = [
                'cmid' => (int) $activity->id,
                'studentid' => (int) $row->userid,
                'grade' => (float) $row->finalgrade,
                'grademax' => $row->grademax === null ? null : (float) $row->grademax,
                'gradedat' => self::iso($row->timemodified),
            ];
            if (count($rows) > self::MAX_ROWS) {
                break;
            }
        }
        [$rows, $truncated] = self::cut($rows);

        return ['truncated' => $truncated, 'grades' => $rows];
    }

    /**
     * Finds the activity of the teacher's view that owns a module instance.
     *
     * @param \course_modinfo $modinfo
     * @param string $modname
     * @param int $instance
     * @return \cm_info|null
     */
    protected static function cm_of(\course_modinfo $modinfo, string $modname, int $instance): ?\cm_info {
        $cm = $modinfo->instances[$modname][$instance] ?? null;
        return ($cm && !$cm->deletioninprogress && $cm->uservisible) ? $cm : null;
    }

    /**
     * Completion of the activities that track it. A student with no completion record has not completed it.
     *
     * @param int $userid
     * @param int $courseid
     * @return array
     */
    public static function get_completion(int $userid, int $courseid): array {
        global $DB;

        [$course, $context] = self::authorize($userid, $courseid);
        $rows = [];
        $info = new \completion_info($course);
        if ($info->is_enabled()) {
            $students = array_flip(self::student_ids($course, $context, $userid));
            $tracked = [];
            foreach (get_fast_modinfo($course, $userid)->get_cms() as $cm) {
                if (!$cm->deletioninprogress && $cm->uservisible && $info->is_enabled($cm) != COMPLETION_TRACKING_NONE) {
                    $tracked[(int) $cm->id] = true;
                }
            }
            if ($tracked) {
                [$insql, $params] = $DB->get_in_or_equal(array_keys($tracked), SQL_PARAMS_NAMED);
                $records = $DB->get_recordset_select(
                    'course_modules_completion',
                    "coursemoduleid {$insql}",
                    $params,
                    'coursemoduleid, userid',
                    'id, coursemoduleid, userid, completionstate, timemodified'
                );
                foreach ($records as $record) {
                    if (!isset($students[(int) $record->userid])) {
                        continue;
                    }
                    // Complete (1) and complete with a pass (2) count; fail (3) and incomplete (0) do not.
                    $done = in_array((int) $record->completionstate, [COMPLETION_COMPLETE, COMPLETION_COMPLETE_PASS], true);
                    $rows[] = [
                        'cmid' => (int) $record->coursemoduleid,
                        'studentid' => (int) $record->userid,
                        'completed' => $done,
                        'completedat' => $done ? self::iso($record->timemodified) : null,
                    ];
                    if (count($rows) > self::MAX_ROWS) {
                        break;
                    }
                }
                $records->close();
            }
        }
        [$rows, $truncated] = self::cut($rows);

        return ['truncated' => $truncated, 'completion' => $rows];
    }

    /**
     * Last access to the course of every student (null if they never entered).
     *
     * @param int $userid
     * @param int $courseid
     * @return array
     */
    public static function get_last_access(int $userid, int $courseid): array {
        global $DB;

        [$course, $context] = self::authorize($userid, $courseid);
        $students = self::student_ids($course, $context, $userid);
        $rows = [];
        if ($students) {
            $accessed = $DB->get_records('user_lastaccess', ['courseid' => $courseid], '', 'userid, timeaccess');
            foreach ($students as $studentid) {
                $rows[] = [
                    'studentid' => $studentid,
                    'lastaccess' => self::iso(isset($accessed[$studentid]) ? $accessed[$studentid]->timeaccess : null),
                ];
            }
        }
        [$rows, $truncated] = self::cut(array_slice($rows, 0, self::MAX_ROWS + 1));

        return ['truncated' => $truncated, 'lastaccess' => $rows];
    }
}
