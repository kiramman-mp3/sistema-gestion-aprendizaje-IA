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
 * Tests for get_backend_token.
 *
 * @package    local_ai_assistant
 * @category   test
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
#[\PHPUnit\Framework\Attributes\CoversClass(get_backend_token::class)]
final class get_backend_token_test extends \core_external\tests\externallib_testcase {
    /**
     * Creates a course and configures the plugin.
     *
     * @return \stdClass
     */
    private function setup_course(): \stdClass {
        $this->resetAfterTest();
        set_config('jwtsecret', 'test-secret-with-at-least-32-characters!', 'local_ai_assistant');
        set_config('backendurl', 'http://backend.test/api/v1', 'local_ai_assistant');
        return $this->getDataGenerator()->create_course();
    }

    public function test_teacher_receives_a_token(): void {
        $course = $this->setup_course();
        $teacher = $this->getDataGenerator()->create_and_enrol($course, 'editingteacher');
        $this->setUser($teacher);

        $result = get_backend_token::execute($course->id);
        $result = external_api::clean_returnvalue(get_backend_token::execute_returns(), $result);

        $this->assertCount(3, explode('.', $result['token']));
        $this->assertGreaterThan(time(), $result['expiresat']);
        $this->assertSame('http://backend.test/api/v1', $result['backendurl']);
    }

    public function test_student_is_denied(): void {
        $course = $this->setup_course();
        $student = $this->getDataGenerator()->create_and_enrol($course, 'student');
        $this->setUser($student);

        $this->expectException(\required_capability_exception::class);
        get_backend_token::execute($course->id);
    }

    public function test_teacher_of_another_course_is_denied(): void {
        $course = $this->setup_course();
        $other = $this->getDataGenerator()->create_course();
        $teacher = $this->getDataGenerator()->create_and_enrol($other, 'editingteacher');
        $this->setUser($teacher);

        $this->expectException(\require_login_exception::class);
        get_backend_token::execute($course->id);
    }
}
