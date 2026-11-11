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

defined('MOODLE_INTERNAL') || die();

global $CFG;
require_once($CFG->dirroot . '/mod/assign/tests/generator.php');

/**
 * Tests for the read functions (ADR-017).
 *
 * @package    local_ai_assistant
 * @category   test
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
#[\PHPUnit\Framework\Attributes\CoversClass(read::class)]
#[\PHPUnit\Framework\Attributes\CoversClass(\local_ai_assistant\local\reader::class)]
final class read_test extends \core_external\tests\externallib_testcase {
    /** @var \stdClass Course used by the tests. */
    private \stdClass $course;

    /** @var \stdClass Teacher who may view the analytics. */
    private \stdClass $teacher;

    /** @var \stdClass[] Enrolled students, by position. */
    private array $students = [];

    /** @var \stdClass Assignment with a due date in the past. */
    private \stdClass $assign;

    /**
     * Creates a course with a teacher, three students and an assignment, and logs in as the integration user.
     */
    protected function setUp(): void {
        parent::setUp();
        $this->resetAfterTest();
        $generator = $this->getDataGenerator();

        $this->course = $generator->create_course(['enablecompletion' => 1]);
        $this->teacher = $generator->create_and_enrol($this->course, 'editingteacher');
        for ($i = 0; $i < 3; $i++) {
            $this->students[$i] = $generator->create_and_enrol($this->course, 'student');
        }
        $this->assign = $generator->create_module('assign', [
            'course' => $this->course->id,
            'name' => 'Tarea 1',
            'duedate' => time() - 7 * DAYSECS,
            'grade' => 100,
            'completion' => COMPLETION_TRACKING_AUTOMATIC,
            'completionview' => 1,
        ]);

        $integration = $generator->create_user();
        $roleid = $generator->create_role();
        $syscontext = \context_system::instance();
        assign_capability('local/ai_assistant:readdata', CAP_ALLOW, $roleid, $syscontext->id);
        role_assign($roleid, $integration->id, $syscontext->id);
        $this->setUser($integration);
    }

    /**
     * Calls a function as the web service layer would and cleans the result.
     *
     * @param string $name Function, for example list_activities.
     * @param array $args Arguments after the teacher and the course.
     * @param \stdClass|null $teacher Defaults to the course teacher.
     * @return array
     */
    private function call(string $name, array $args = [], ?\stdClass $teacher = null): array {
        $result = read::$name((int) ($teacher ?? $this->teacher)->id, (int) $this->course->id, ...$args);
        return external_api::clean_returnvalue(read::{$name . '_returns'}(), $result);
    }

    /**
     * Makes the assignment submission of a student.
     *
     * @param int $index Student.
     * @param string $status Moodle submission status.
     * @param int $time Submission time.
     * @param float|null $grade Grade, or null for none.
     */
    private function submit(int $index, string $status, int $time, ?float $grade = null): void {
        global $DB;

        $student = $this->students[$index];
        $assignid = (int) $this->assign->id;
        $DB->insert_record('assign_submission', (object) [
            'assignment' => $this->assign->id,
            'userid' => $student->id,
            'timecreated' => $time,
            'timemodified' => $time,
            'status' => $status,
            'groupid' => 0,
            'attemptnumber' => 0,
            'latest' => 1,
        ]);
        if ($grade !== null) {
            $DB->insert_record('assign_grades', (object) [
                'assignment' => $assignid,
                'userid' => $student->id,
                'timecreated' => $time,
                'timemodified' => $time,
                'grader' => $this->teacher->id,
                'grade' => $grade,
                'attemptnumber' => 0,
            ]);
        }
    }

    /**
     * Ids of the students of a result, sorted.
     *
     * @param array $rows
     * @return int[]
     */
    private function student_ids(array $rows): array {
        $ids = array_column($rows, 'studentid');
        sort($ids);
        return $ids;
    }

    /**
     * No response ever carries a name, an email or an identity number.
     */
    public function test_responses_hold_ids_and_values_only(): void {
        $this->submit(0, 'submitted', time() - DAYSECS);
        $allowed = ['truncated', 'cmid', 'modname', 'name', 'sectionnum', 'visible', 'duedate', 'maxgrade', 'studentid',
            'status', 'submittedat', 'late', 'grade', 'grademax', 'gradedat', 'completed', 'completedat', 'lastaccess',
            'activities', 'students', 'submissions', 'pending', 'grades', 'completion'];
        $cmid = (int) $this->assign->cmid;
        $results = [
            $this->call('list_activities'),
            $this->call('list_students'),
            $this->call('get_submissions', [$cmid]),
            $this->call('get_pending_grading'),
            $this->call('get_grades'),
            $this->call('get_completion'),
            $this->call('get_last_access'),
        ];
        $json = json_encode($results);

        foreach ($results as $result) {
            $this->assertEmpty(array_diff(array_keys($result), $allowed));
        }
        foreach ($this->students as $student) {
            $this->assertStringNotContainsString($student->email, $json);
            $this->assertStringNotContainsString($student->lastname, $json);
        }
        $this->assertStringNotContainsString('"firstname"', $json);
        $this->assertStringNotContainsString('"email"', $json);
        $this->assertStringNotContainsString('"idnumber"', $json);
    }

    /**
     * Activities come with their type, order, due date and maximum grade.
     */
    public function test_list_activities(): void {
        $generator = $this->getDataGenerator();
        $generator->create_module('forum', ['course' => $this->course->id, 'name' => 'Foro']);
        $generator->create_module('page', ['course' => $this->course->id, 'name' => 'Lectura', 'visible' => 0]);

        $result = $this->call('list_activities');

        $this->assertFalse($result['truncated']);
        $byname = array_column($result['activities'], null, 'name');
        $this->assertSame('assign', $byname['Tarea 1']['modname']);
        $this->assertEquals($this->assign->cmid, $byname['Tarea 1']['cmid']);
        $this->assertSame(gmdate('Y-m-d\TH:i:s\Z', (int) $this->assign->duedate), $byname['Tarea 1']['duedate']);
        $this->assertEquals(100.0, $byname['Tarea 1']['maxgrade']);
        $this->assertSame('forum', $byname['Foro']['modname']);
        $this->assertNull($byname['Lectura']['duedate']);
        $this->assertFalse($byname['Lectura']['visible']);
    }

    /**
     * The student list holds only active students, not teachers or suspended enrolments.
     */
    public function test_list_students(): void {
        $generator = $this->getDataGenerator();
        $suspended = $generator->create_user();
        $generator->enrol_user($suspended->id, $this->course->id, 'student', 'manual', 0, 0, ENROL_USER_SUSPENDED);

        $result = $this->call('list_students');

        $expected = array_map(fn($s) => (int) $s->id, $this->students);
        sort($expected);
        $this->assertSame($expected, $this->student_ids($result['students']));
        $this->assertNotContains((int) $this->teacher->id, $this->student_ids($result['students']));
        $this->assertNotContains((int) $suspended->id, $this->student_ids($result['students']));
    }

    /**
     * Every state of a submission is told apart, and late deliveries are flagged.
     */
    public function test_get_submissions_states(): void {
        $due = (int) $this->assign->duedate;
        $this->submit(0, 'submitted', $due - DAYSECS);
        $this->submit(1, 'submitted', $due + DAYSECS, 80.0);
        $this->submit(2, 'draft', $due - DAYSECS);
        $extra = $this->getDataGenerator()->create_and_enrol($this->course, 'student');

        $result = $this->call('get_submissions', [(int) $this->assign->cmid]);

        $this->assertEquals($this->assign->cmid, $result['cmid']);
        $rows = array_column($result['submissions'], null, 'studentid');
        $this->assertSame('submitted', $rows[$this->students[0]->id]['status']);
        $this->assertFalse($rows[$this->students[0]->id]['late']);
        $this->assertSame('graded', $rows[$this->students[1]->id]['status']);
        $this->assertTrue($rows[$this->students[1]->id]['late']);
        $this->assertSame('draft', $rows[$this->students[2]->id]['status']);
        $this->assertNull($rows[$this->students[2]->id]['submittedat']);
        // Nothing submitted and the due date is a week old.
        $this->assertSame('missing', $rows[$extra->id]['status']);
        $this->assertCount(4, $rows);
    }

    /**
     * Before the due date, an empty submission is new, not missing.
     */
    public function test_get_submissions_new_before_the_due_date(): void {
        global $DB;

        $DB->set_field('assign', 'duedate', time() + DAYSECS, ['id' => $this->assign->id]);

        $result = $this->call('get_submissions', [(int) $this->assign->cmid]);

        $this->assertSame(['new'], array_values(array_unique(array_column($result['submissions'], 'status'))));
    }

    /**
     * Submissions can only be read for assignments of the course.
     */
    public function test_get_submissions_rejects_other_activities(): void {
        $forum = $this->getDataGenerator()->create_module('forum', ['course' => $this->course->id]);
        $other = $this->getDataGenerator()->create_course();
        $foreign = $this->getDataGenerator()->create_module('assign', ['course' => $other->id]);

        foreach ([(int) $forum->cmid, (int) $foreign->cmid, 999999] as $cmid) {
            try {
                $this->call('get_submissions', [$cmid]);
                $this->fail("cmid {$cmid} should be rejected");
            } catch (\invalid_parameter_exception $e) {
                $this->assertInstanceOf(\invalid_parameter_exception::class, $e);
            }
        }
    }

    /**
     * Only submitted work without a grade is pending, and a graded one is not.
     */
    public function test_get_pending_grading(): void {
        $due = (int) $this->assign->duedate;
        $this->submit(0, 'submitted', $due - DAYSECS);
        $this->submit(1, 'submitted', $due - DAYSECS, 70.0);
        $this->submit(2, 'draft', $due - DAYSECS);

        $all = $this->call('get_pending_grading');
        $one = $this->call('get_pending_grading', [(int) $this->assign->cmid]);

        $this->assertCount(1, $all['pending']);
        $this->assertEquals($this->students[0]->id, $all['pending'][0]['studentid']);
        $this->assertEquals($this->assign->cmid, $all['pending'][0]['cmid']);
        $this->assertSame($all, $one);
    }

    /**
     * A grade is returned with its maximum, and a hidden grade is not returned at all.
     */
    public function test_get_grades_hides_hidden_grades(): void {
        global $CFG;
        require_once($CFG->libdir . '/gradelib.php');

        $item = \grade_item::fetch(['courseid' => $this->course->id, 'itemtype' => 'mod', 'itemmodule' => 'assign',
            'iteminstance' => $this->assign->id, 'itemnumber' => 0]);
        $item->update_final_grade($this->students[0]->id, 85.5);
        $item->update_final_grade($this->students[1]->id, 40.0);
        $grade = \grade_grade::fetch(['itemid' => $item->id, 'userid' => $this->students[1]->id]);
        $grade->set_hidden(1);

        $result = $this->call('get_grades', [(int) $this->assign->cmid]);

        $this->assertCount(1, $result['grades']);
        $this->assertEquals($this->students[0]->id, $result['grades'][0]['studentid']);
        $this->assertEquals(85.5, $result['grades'][0]['grade']);
        $this->assertEquals(100.0, $result['grades'][0]['grademax']);
        $this->assertEquals($this->assign->cmid, $result['grades'][0]['cmid']);
        $this->assertSame($result['grades'], $this->call('get_grades')['grades']);
    }

    /**
     * A student without a grade is absent, never a zero.
     */
    public function test_get_grades_omits_students_without_a_grade(): void {
        $this->assertSame([], $this->call('get_grades')['grades']);
    }

    /**
     * Completion tells who completed an activity and when; incomplete is not completed.
     */
    public function test_get_completion(): void {
        global $DB;

        foreach ([0 => COMPLETION_COMPLETE, 1 => COMPLETION_INCOMPLETE] as $index => $state) {
            $DB->insert_record('course_modules_completion', (object) [
                'coursemoduleid' => $this->assign->cmid,
                'userid' => $this->students[$index]->id,
                'completionstate' => $state,
                'viewed' => 0,
                'timemodified' => 1760000000,
            ]);
        }

        $result = $this->call('get_completion');

        $rows = array_column($result['completion'], null, 'studentid');
        $this->assertTrue($rows[$this->students[0]->id]['completed']);
        $this->assertSame('2025-10-09T08:53:20Z', $rows[$this->students[0]->id]['completedat']);
        $this->assertFalse($rows[$this->students[1]->id]['completed'] ?? false);
        $this->assertNull($rows[$this->students[1]->id]['completedat'] ?? null);
        $this->assertArrayNotHasKey($this->students[2]->id, $rows);
    }

    /**
     * A course without completion tracking has nothing to report.
     */
    public function test_get_completion_is_empty_when_disabled(): void {
        global $DB;

        $DB->set_field('course', 'enablecompletion', 0, ['id' => $this->course->id]);
        \course_modinfo::clear_instance_cache();

        $this->assertSame([], $this->call('get_completion')['completion']);
    }

    /**
     * A student that never entered has a null last access.
     */
    public function test_get_last_access(): void {
        global $DB;

        $DB->insert_record('user_lastaccess', (object) [
            'userid' => $this->students[0]->id,
            'courseid' => $this->course->id,
            'timeaccess' => 1760000000,
        ]);

        $result = $this->call('get_last_access');

        $rows = array_column($result['lastaccess'], null, 'studentid');
        $this->assertSame('2025-10-09T08:53:20Z', $rows[$this->students[0]->id]['lastaccess']);
        $this->assertNull($rows[$this->students[1]->id]['lastaccess']);
        $this->assertCount(3, $rows);
    }

    /**
     * With separate groups a teacher without access to all groups only gets the students of their groups.
     */
    public function test_separate_groups_limit_what_a_teacher_reads(): void {
        global $DB;

        $generator = $this->getDataGenerator();
        $DB->set_field('course', 'groupmode', SEPARATEGROUPS, ['id' => $this->course->id]);
        $DB->set_field('course', 'groupmodeforce', 1, ['id' => $this->course->id]);
        $this->course = get_course($this->course->id);
        $tutor = $generator->create_and_enrol($this->course, 'teacher');
        $group = $generator->create_group(['courseid' => $this->course->id]);
        $generator->create_group_member(['groupid' => $group->id, 'userid' => $tutor->id]);
        $generator->create_group_member(['groupid' => $group->id, 'userid' => $this->students[0]->id]);

        $tutorview = $this->call('list_students', [], $tutor);
        $teacherview = $this->call('list_students');

        $this->assertSame([(int) $this->students[0]->id], $this->student_ids($tutorview['students']));
        $this->assertCount(3, $teacherview['students']);
    }

    /**
     * A user without viewanalytics in the course is refused by every function.
     */
    public function test_a_teacher_without_viewanalytics_is_refused(): void {
        $generator = $this->getDataGenerator();
        $roleid = $generator->create_role();
        $other = $generator->create_and_enrol($this->course, 'student');
        $outsider = $generator->create_user();
        $cmid = (int) $this->assign->cmid;

        $calls = [
            ['list_activities', []], ['list_students', []], ['get_submissions', [$cmid]],
            ['get_pending_grading', []], ['get_grades', []], ['get_completion', []], ['get_last_access', []],
        ];
        foreach ([$other, $outsider] as $user) {
            foreach ($calls as [$name, $args]) {
                try {
                    $this->call($name, $args, $user);
                    $this->fail("{$name} should refuse a user without viewanalytics");
                } catch (\required_capability_exception $e) {
                    $this->assertInstanceOf(\required_capability_exception::class, $e);
                }
            }
        }
        $this->assertNotEmpty($roleid);
    }

    /**
     * Only the integration user may call the functions, not even a teacher.
     */
    public function test_only_the_integration_user_may_call(): void {
        $this->setUser($this->teacher);

        $this->expectException(\required_capability_exception::class);
        $this->call('list_students');
    }

    /**
     * An unknown or suspended teacher is refused.
     */
    public function test_invalid_teachers_are_refused(): void {
        global $DB;

        $suspended = $this->getDataGenerator()->create_and_enrol($this->course, 'editingteacher');
        $DB->set_field('user', 'suspended', 1, ['id' => $suspended->id]);

        foreach ([(object) ['id' => 987654], $suspended] as $teacher) {
            try {
                $this->call('list_students', [], $teacher);
                $this->fail('A teacher that does not exist or is suspended should be refused');
            } catch (\invalid_parameter_exception $e) {
                $this->assertInstanceOf(\invalid_parameter_exception::class, $e);
            }
        }
    }

    /**
     * The front page has no course data.
     */
    public function test_front_page_is_refused(): void {
        $this->expectException(\invalid_parameter_exception::class);
        read::list_students((int) $this->teacher->id, SITEID);
    }

    /**
     * A list is cut at the maximum and reports it.
     */
    public function test_a_long_list_is_truncated(): void {
        $max = \local_ai_assistant\local\reader::MAX_ROWS;
        [$rows, $truncated] = \local_ai_assistant\local\reader::cut(range(1, $max + 1));
        $this->assertCount($max, $rows);
        $this->assertTrue($truncated);

        [$rows, $truncated] = \local_ai_assistant\local\reader::cut(range(1, $max));
        $this->assertCount($max, $rows);
        $this->assertFalse($truncated);
    }
}
