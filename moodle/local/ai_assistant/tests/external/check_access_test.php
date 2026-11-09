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

/**
 * Tests for check_access.
 *
 * @package    local_ai_assistant
 * @category   test
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
#[\PHPUnit\Framework\Attributes\CoversClass(check_access::class)]
final class check_access_test extends \core_external\tests\externallib_testcase {
    /** @var \stdClass Course used by the tests. */
    private \stdClass $course;

    /**
     * Creates a course and logs in as an integration user holding only checkaccess.
     */
    protected function setUp(): void {
        parent::setUp();
        $this->resetAfterTest();
        $this->course = $this->getDataGenerator()->create_course();

        $integration = $this->getDataGenerator()->create_user();
        $roleid = $this->getDataGenerator()->create_role();
        $syscontext = \context_system::instance();
        assign_capability('local/ai_assistant:checkaccess', CAP_ALLOW, $roleid, $syscontext->id);
        role_assign($roleid, $integration->id, $syscontext->id);
        $this->setUser($integration);
    }

    /**
     * Calls the function and cleans the result as the web service layer would.
     *
     * @param int $userid
     * @param int $courseid
     * @return array
     */
    private function check(int $userid, int $courseid): array {
        return external_api::clean_returnvalue(
            check_access::execute_returns(),
            check_access::execute($userid, $courseid)
        );
    }

    public function test_editing_teacher_has_all_capabilities(): void {
        $teacher = $this->getDataGenerator()->create_and_enrol($this->course, 'editingteacher');

        $result = $this->check($teacher->id, $this->course->id);

        $this->assertTrue($result['courseexists']);
        $this->assertTrue($result['active']);
        $this->assertSame(['editingteacher'], $result['roles']);
        $this->assertSame(['use' => true, 'publish' => true, 'viewanalytics' => true], $result['capabilities']);
    }

    public function test_non_editing_teacher_cannot_publish(): void {
        $teacher = $this->getDataGenerator()->create_and_enrol($this->course, 'teacher');

        $result = $this->check($teacher->id, $this->course->id);

        $this->assertSame(['use' => true, 'publish' => false, 'viewanalytics' => true], $result['capabilities']);
    }

    public function test_student_has_no_capabilities(): void {
        $student = $this->getDataGenerator()->create_and_enrol($this->course, 'student');

        $result = $this->check($student->id, $this->course->id);

        $this->assertSame(['student'], $result['roles']);
        $this->assertSame(['use' => false, 'publish' => false, 'viewanalytics' => false], $result['capabilities']);
    }

    public function test_teacher_of_another_course_has_no_capabilities(): void {
        $other = $this->getDataGenerator()->create_course();
        $teacher = $this->getDataGenerator()->create_and_enrol($other, 'editingteacher');

        $result = $this->check($teacher->id, $this->course->id);

        $this->assertSame([], $result['roles']);
        $this->assertFalse($result['capabilities']['use']);
    }

    public function test_suspended_user_has_no_capabilities(): void {
        global $DB;
        $teacher = $this->getDataGenerator()->create_and_enrol($this->course, 'editingteacher');
        $DB->set_field('user', 'suspended', 1, ['id' => $teacher->id]);

        $result = $this->check($teacher->id, $this->course->id);

        $this->assertFalse($result['active']);
        $this->assertFalse($result['capabilities']['use']);
    }

    public function test_missing_course_and_front_page_report_no_course(): void {
        $teacher = $this->getDataGenerator()->create_user();

        $this->assertFalse($this->check($teacher->id, 999999)['courseexists']);
        $this->assertFalse($this->check($teacher->id, SITEID)['courseexists']);
    }

    public function test_caller_without_checkaccess_is_denied(): void {
        $this->setUser($this->getDataGenerator()->create_user());

        $this->expectException(\required_capability_exception::class);
        check_access::execute(2, $this->course->id);
    }
}
