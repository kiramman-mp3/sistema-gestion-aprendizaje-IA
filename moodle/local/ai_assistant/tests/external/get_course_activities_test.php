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
 * Tests for get_course_activities.
 *
 * @package    local_ai_assistant
 * @category   test
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
#[\PHPUnit\Framework\Attributes\CoversClass(get_course_activities::class)]
final class get_course_activities_test extends \core_external\tests\externallib_testcase {
    /** @var \stdClass Course used by the tests. */
    private \stdClass $course;

    /**
     * Creates a course and logs in as its editing teacher.
     */
    protected function setUp(): void {
        parent::setUp();
        $this->resetAfterTest();
        $generator = $this->getDataGenerator();
        $this->course = $generator->create_course(['numsections' => 2]);
        $this->setUser($generator->create_and_enrol($this->course, 'editingteacher'));
    }

    /**
     * Calls the function and cleans the result as the web service layer would.
     *
     * @return array
     */
    private function activities(): array {
        return external_api::clean_returnvalue(
            get_course_activities::execute_returns(),
            get_course_activities::execute((int) $this->course->id)
        );
    }

    /**
     * It lists the activities in course order, with their section, and leaves labels out.
     */
    public function test_lists_activities_in_order_without_labels(): void {
        $generator = $this->getDataGenerator();
        $first = $generator->create_module('assign', ['course' => $this->course->id, 'name' => 'Tarea 1', 'section' => 1]);
        $generator->create_module('label', ['course' => $this->course->id, 'intro' => 'Aviso', 'section' => 1]);
        $second = $generator->create_module('forum', ['course' => $this->course->id, 'name' => 'Foro', 'section' => 2]);

        $activities = $this->activities();

        $this->assertCount(2, $activities);
        $this->assertSame((int) $first->cmid, $activities[0]['cmid']);
        $this->assertSame('Tarea 1', $activities[0]['name']);
        $this->assertSame('assign', $activities[0]['modname']);
        $this->assertSame(1, $activities[0]['sectionnum']);
        $this->assertSame((int) $second->cmid, $activities[1]['cmid']);
        $this->assertSame('forum', $activities[1]['modname']);
        $this->assertSame(2, $activities[1]['sectionnum']);
        $this->assertNotSame('', $activities[1]['sectionname']);
    }

    /**
     * A teacher sees hidden activities and they are flagged; students would not see them.
     */
    public function test_reports_hidden_activities_to_the_teacher(): void {
        $this->getDataGenerator()->create_module('assign', ['course' => $this->course->id, 'visible' => 0]);

        $activities = $this->activities();

        $this->assertCount(1, $activities);
        $this->assertFalse($activities[0]['visible']);
    }

    /**
     * An empty course gives an empty list.
     */
    public function test_empty_course(): void {
        $this->assertSame([], $this->activities());
    }

    /**
     * A user who is not in the course cannot list its activities.
     */
    public function test_a_user_outside_the_course_is_denied(): void {
        $this->setUser($this->getDataGenerator()->create_user());

        $this->expectException(\core\exception\moodle_exception::class);

        $this->activities();
    }

    /**
     * A student, who lacks the assistant capability, is denied.
     */
    public function test_a_student_is_denied(): void {
        $this->setUser($this->getDataGenerator()->create_and_enrol($this->course, 'student'));

        $this->expectException(\required_capability_exception::class);

        $this->activities();
    }
}
