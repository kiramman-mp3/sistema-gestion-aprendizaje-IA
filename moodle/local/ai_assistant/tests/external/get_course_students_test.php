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
 * Tests for get_course_students.
 *
 * @package    local_ai_assistant
 * @category   test
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
#[\PHPUnit\Framework\Attributes\CoversClass(get_course_students::class)]
final class get_course_students_test extends \core_external\tests\externallib_testcase {
    /** @var \stdClass Course used by the tests. */
    private \stdClass $course;

    /**
     * Creates a course with students and logs in as its editing teacher.
     */
    protected function setUp(): void {
        parent::setUp();
        $this->resetAfterTest();
        $generator = $this->getDataGenerator();
        $this->course = $generator->create_course();
        $generator->create_and_enrol($this->course, 'student', ['firstname' => 'Beatriz', 'lastname' => 'Zambrano']);
        $generator->create_and_enrol($this->course, 'student', ['firstname' => 'Andrés', 'lastname' => 'Álvarez']);
        $this->setUser($generator->create_and_enrol($this->course, 'editingteacher'));
    }

    /**
     * Calls the function and cleans the result as the web service layer would.
     *
     * @return array
     */
    private function students(): array {
        return external_api::clean_returnvalue(
            get_course_students::execute_returns(),
            get_course_students::execute((int) $this->course->id)
        );
    }

    /**
     * It lists the students with their names, sorted, and no teachers.
     */
    public function test_lists_students_only(): void {
        $students = $this->students();

        $this->assertCount(2, $students);
        $names = array_column($students, 'fullname');
        $this->assertContains('Andrés Álvarez', $names);
        $this->assertContains('Beatriz Zambrano', $names);
        $this->assertSame(['id', 'fullname'], array_keys($students[0]));
    }

    /**
     * Suspended enrolments are not listed.
     */
    public function test_skips_suspended_enrolments(): void {
        global $DB;

        $generator = $this->getDataGenerator();
        $suspended = $generator->create_user(['firstname' => 'Carla', 'lastname' => 'Suspendida']);
        $generator->enrol_user($suspended->id, $this->course->id, 'student', 'manual', 0, 0, ENROL_USER_SUSPENDED);

        $this->assertNotContains('Carla Suspendida', array_column($this->students(), 'fullname'));
        $this->assertTrue($DB->record_exists('user_enrolments', ['userid' => $suspended->id]));
    }

    /**
     * A user who cannot view the analytics of the course gets nothing.
     */
    public function test_requires_the_analytics_capability(): void {
        $this->setUser($this->getDataGenerator()->create_and_enrol($this->course, 'student'));

        $this->expectException(\required_capability_exception::class);

        $this->students();
    }

    /**
     * A user who is not in the course gets nothing.
     */
    public function test_a_user_outside_the_course_is_denied(): void {
        $this->setUser($this->getDataGenerator()->create_user());

        $this->expectException(\core\exception\moodle_exception::class);

        $this->students();
    }
}
