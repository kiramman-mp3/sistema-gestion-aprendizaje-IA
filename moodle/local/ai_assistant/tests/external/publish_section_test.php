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
 * Tests for publish_section.
 *
 * @package    local_ai_assistant
 * @category   test
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
#[\PHPUnit\Framework\Attributes\CoversClass(publish_section::class)]
#[\PHPUnit\Framework\Attributes\CoversClass(\local_ai_assistant\local\publisher::class)]
final class publish_section_test extends \core_external\tests\externallib_testcase {
    /** @var string Id of a proposal item. */
    private const ITEM = '11111111-1111-4111-8111-111111111111';

    /** @var \stdClass Course used by the tests. */
    private \stdClass $course;

    /** @var \stdClass Teacher with editing rights in the course. */
    private \stdClass $teacher;

    /**
     * Creates a course and a teacher, and logs in as an integration user holding only createcontent.
     */
    protected function setUp(): void {
        parent::setUp();
        $this->resetAfterTest();
        $generator = $this->getDataGenerator();
        $this->course = $generator->create_course();
        $this->teacher = $generator->create_and_enrol($this->course, 'editingteacher');

        $integration = $generator->create_user();
        $roleid = $generator->create_role();
        $syscontext = \context_system::instance();
        assign_capability('local/ai_assistant:createcontent', CAP_ALLOW, $roleid, $syscontext->id);
        role_assign($roleid, $integration->id, $syscontext->id);
        $this->setUser($integration);
    }

    /**
     * Calls the function and cleans the result as the web service layer would.
     *
     * @param string $itemid
     * @param string $name
     * @param string $summary
     * @param \stdClass|null $teacher Defaults to the editing teacher.
     * @param int|null $courseid Defaults to the test course.
     * @return array
     */
    private function publish(
        string $itemid = self::ITEM,
        string $name = 'Unidad 1',
        string $summary = '',
        ?\stdClass $teacher = null,
        ?int $courseid = null
    ): array {
        return external_api::clean_returnvalue(
            publish_section::execute_returns(),
            publish_section::execute(
                (int) ($teacher ?? $this->teacher)->id,
                $courseid ?? (int) $this->course->id,
                $itemid,
                $name,
                $summary
            )
        );
    }

    /**
     * A new item creates a section with its name and description.
     */
    public function test_creates_a_section(): void {
        global $DB;

        $result = $this->publish(self::ITEM, 'Requisitos', "Tema A\nTema B");

        $this->assertTrue($result['created']);
        $section = $DB->get_record('course_sections', ['id' => $result['sectionid']], '*', MUST_EXIST);
        $this->assertEquals($this->course->id, $section->course);
        $this->assertEquals($result['sectionnum'], $section->section);
        $this->assertSame('Requisitos', $section->name);
        $this->assertSame("Tema A<br>\nTema B", $section->summary);
        $this->assertEquals(FORMAT_HTML, $section->summaryformat);
        $this->assertTrue($DB->record_exists('local_ai_assistant_items', [
            'courseid' => $this->course->id,
            'itemuuid' => self::ITEM,
            'itemtype' => 'section',
            'moodleid' => $result['sectionid'],
        ]));
    }

    /**
     * Asking again for the same item returns the same section and creates nothing (SEC-04).
     */
    public function test_repeating_an_item_does_not_duplicate_the_section(): void {
        global $DB;

        $first = $this->publish();
        $sections = $DB->count_records('course_sections', ['course' => $this->course->id]);

        $second = $this->publish(self::ITEM, 'Otro nombre');

        $this->assertFalse($second['created']);
        $this->assertSame($first['sectionid'], $second['sectionid']);
        $this->assertSame($first['sectionnum'], $second['sectionnum']);
        $this->assertEquals($sections, $DB->count_records('course_sections', ['course' => $this->course->id]));
        $this->assertSame('Unidad 1', $DB->get_field('course_sections', 'name', ['id' => $first['sectionid']]));
    }

    /**
     * Different items create different sections, in order.
     */
    public function test_different_items_create_different_sections(): void {
        $first = $this->publish('11111111-1111-4111-8111-111111111111', 'Uno');
        $second = $this->publish('22222222-2222-4222-8222-222222222222', 'Dos');

        $this->assertNotEquals($first['sectionid'], $second['sectionid']);
        $this->assertGreaterThan($first['sectionnum'], $second['sectionnum']);
    }

    /**
     * The id is recognized without regard to case.
     */
    public function test_item_id_is_case_insensitive(): void {
        $first = $this->publish('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA');
        $second = $this->publish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

        $this->assertFalse($second['created']);
        $this->assertSame($first['sectionid'], $second['sectionid']);
    }

    /**
     * The same item id in another course is a different item.
     */
    public function test_the_mapping_is_per_course(): void {
        $other = $this->getDataGenerator()->create_course();
        $this->getDataGenerator()->enrol_user($this->teacher->id, $other->id, 'editingteacher');

        $here = $this->publish();
        $there = $this->publish(self::ITEM, 'Unidad 1', '', null, (int) $other->id);

        $this->assertTrue($there['created']);
        $this->assertNotEquals($here['sectionid'], $there['sectionid']);
    }

    /**
     * If the teacher deleted the section in Moodle, publishing the item creates it again.
     */
    public function test_recreates_a_section_deleted_in_moodle(): void {
        global $DB;

        $first = $this->publish();
        course_delete_section($this->course, $DB->get_record('course_sections', ['id' => $first['sectionid']]), true);

        $second = $this->publish();

        $this->assertTrue($second['created']);
        $this->assertNotEquals($first['sectionid'], $second['sectionid']);
        $this->assertEquals(1, $DB->count_records('local_ai_assistant_items', ['itemuuid' => self::ITEM]));
    }

    /**
     * Text from a syllabus cannot become markup, and a long name is cut to what Moodle stores.
     */
    public function test_cleans_text(): void {
        global $DB;

        $result = $this->publish(self::ITEM, str_repeat('N', 300), '<script>alert(1)</script> & más');

        $section = $DB->get_record('course_sections', ['id' => $result['sectionid']], '*', MUST_EXIST);
        $this->assertSame(255, \core_text::strlen($section->name));
        $this->assertStringNotContainsString('<script>', $section->summary);
        $this->assertStringContainsString('&lt;script&gt;', $section->summary);
    }

    /**
     * A teacher without editing rights cannot publish, and nothing is created (permission test).
     */
    public function test_a_teacher_without_editing_rights_is_denied(): void {
        global $DB;

        $helper = $this->getDataGenerator()->create_and_enrol($this->course, 'teacher');
        $sections = $DB->count_records('course_sections', ['course' => $this->course->id]);

        try {
            $this->publish(self::ITEM, 'Unidad', '', $helper);
            $this->fail('A non-editing teacher must not publish.');
        } catch (\required_capability_exception $exception) {
            $this->assertSame('nopermissions', $exception->errorcode);
        }

        $this->assertEquals($sections, $DB->count_records('course_sections', ['course' => $this->course->id]));
        $this->assertEquals(0, $DB->count_records('local_ai_assistant_items'));
    }

    /**
     * A user who is not in the course cannot publish to it.
     */
    public function test_a_user_outside_the_course_is_denied(): void {
        $this->expectException(\required_capability_exception::class);

        $this->publish(self::ITEM, 'Unidad', '', $this->getDataGenerator()->create_user());
    }

    /**
     * Only the integration user, holding createcontent, may call the function.
     */
    public function test_requires_the_integration_capability(): void {
        $this->setUser($this->teacher);

        $this->expectException(\required_capability_exception::class);

        $this->publish();
    }

    /**
     * Suspended and deleted teachers, and the site front page, are rejected.
     */
    public function test_rejects_inactive_teachers_and_the_front_page(): void {
        $suspended = $this->getDataGenerator()->create_and_enrol($this->course, 'editingteacher', ['suspended' => 1]);
        try {
            $this->publish(self::ITEM, 'Unidad', '', $suspended);
            $this->fail('A suspended teacher must not publish.');
        } catch (\invalid_parameter_exception $exception) {
            $this->assertStringContainsString('not active', $exception->debuginfo);
        }

        $this->expectException(\invalid_parameter_exception::class);
        $this->publish(self::ITEM, 'Unidad', '', null, (int) SITEID);
    }

    /**
     * The item id must be a UUID.
     */
    public function test_rejects_an_id_that_is_not_a_uuid(): void {
        $this->expectException(\invalid_parameter_exception::class);

        $this->publish('no-es-un-uuid');
    }

    /**
     * Deleting the course forgets what was published in it.
     */
    public function test_deleting_the_course_removes_its_mapping(): void {
        global $DB;

        $this->publish();
        $this->assertEquals(1, $DB->count_records('local_ai_assistant_items'));

        delete_course($this->course, false);

        $this->assertEquals(0, $DB->count_records('local_ai_assistant_items'));
    }
}
