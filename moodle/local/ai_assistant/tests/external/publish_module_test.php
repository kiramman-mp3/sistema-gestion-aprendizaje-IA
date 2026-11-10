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
 * Tests for publish_module.
 *
 * @package    local_ai_assistant
 * @category   test
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
#[\PHPUnit\Framework\Attributes\CoversClass(publish_module::class)]
#[\PHPUnit\Framework\Attributes\CoversClass(\local_ai_assistant\local\publisher::class)]
final class publish_module_test extends \core_external\tests\externallib_testcase {
    /** @var string Id of a proposal item. */
    private const ITEM = '33333333-3333-4333-8333-333333333333';

    /** @var \stdClass Course used by the tests. */
    private \stdClass $course;

    /** @var \stdClass Teacher with editing rights in the course. */
    private \stdClass $teacher;

    /** @var \stdClass Integration user. */
    private \stdClass $integration;

    /** @var \stdClass Section where activities are created (row of course_sections). */
    private \stdClass $section;

    /**
     * Creates a course with a section and a teacher, and logs in as an integration user.
     */
    protected function setUp(): void {
        global $DB;

        parent::setUp();
        $this->resetAfterTest();
        $generator = $this->getDataGenerator();
        $this->course = $generator->create_course(['numsections' => 2]);
        $this->teacher = $generator->create_and_enrol($this->course, 'editingteacher', ['timezone' => 'America/Guayaquil']);
        $this->section = $DB->get_record('course_sections', ['course' => $this->course->id, 'section' => 1], '*', MUST_EXIST);

        $this->integration = $generator->create_user();
        $roleid = $generator->create_role();
        $syscontext = \context_system::instance();
        assign_capability('local/ai_assistant:createcontent', CAP_ALLOW, $roleid, $syscontext->id);
        role_assign($roleid, $this->integration->id, $syscontext->id);
        $this->setUser($this->integration);
    }

    /**
     * Calls the function and cleans the result as the web service layer would.
     *
     * @param string $modname
     * @param string $itemid
     * @param array $overrides Values that replace the defaults: name, intro, duedate, teacher, sectionid, courseid.
     * @return array
     */
    private function publish(string $modname = 'assign', string $itemid = self::ITEM, array $overrides = []): array {
        $values = $overrides + [
            'name' => 'Tarea 1',
            'intro' => '',
            'duedate' => '',
            'teacher' => $this->teacher,
            'sectionid' => (int) $this->section->id,
            'courseid' => (int) $this->course->id,
        ];
        return external_api::clean_returnvalue(
            publish_module::execute_returns(),
            publish_module::execute(
                (int) $values['teacher']->id,
                $values['courseid'],
                $itemid,
                $values['sectionid'],
                $modname,
                $values['name'],
                $values['intro'],
                $values['duedate']
            )
        );
    }

    /**
     * Each supported kind creates its activity in the section, hidden, with the item id as idnumber.
     *
     * @param string $modname
     * @dataProvider modules_provider
     */
    #[\PHPUnit\Framework\Attributes\DataProvider('modules_provider')]
    public function test_creates_each_kind_of_activity(string $modname): void {
        global $DB;

        $result = $this->publish($modname, self::ITEM, ['name' => 'Actividad de prueba', 'intro' => 'Instrucciones']);

        $this->assertTrue($result['created']);
        $cm = get_coursemodule_from_id($modname, $result['cmid'], $this->course->id, false, MUST_EXIST);
        $this->assertSame($modname, $cm->modname);
        $this->assertEquals($this->section->id, $cm->section);
        $this->assertEquals(0, $cm->visible, 'Activities are created hidden so the teacher reviews them first.');
        $this->assertSame('ai:' . self::ITEM, $cm->idnumber);
        if ($modname !== 'label') {
            $this->assertSame('Actividad de prueba', $cm->name);
        }
        $this->assertTrue($DB->record_exists('local_ai_assistant_items', [
            'courseid' => $this->course->id,
            'itemuuid' => self::ITEM,
            'itemtype' => 'module',
            'moodleid' => $result['cmid'],
        ]));
    }

    /**
     * Kinds of activity the plugin creates (D-05).
     *
     * @return array
     */
    public static function modules_provider(): array {
        return [
            'assign' => ['assign'],
            'forum' => ['forum'],
            'quiz' => ['quiz'],
            'label' => ['label'],
            'page' => ['page'],
        ];
    }

    /**
     * Asking again for the same item returns the same activity and creates nothing (SEC-04).
     */
    public function test_repeating_an_item_does_not_duplicate_the_activity(): void {
        global $DB;

        $first = $this->publish('assign');
        $modules = $DB->count_records('course_modules', ['course' => $this->course->id]);

        $second = $this->publish('assign', self::ITEM, ['name' => 'Otro nombre']);

        $this->assertFalse($second['created']);
        $this->assertSame($first['cmid'], $second['cmid']);
        $this->assertEquals($modules, $DB->count_records('course_modules', ['course' => $this->course->id]));
        $this->assertEquals(1, $DB->count_records('assign', ['course' => $this->course->id]));
    }

    /**
     * If the mapping row was lost, the idnumber still identifies the activity and it is adopted.
     */
    public function test_adopts_an_activity_whose_mapping_was_lost(): void {
        global $DB;

        $first = $this->publish('forum');
        $DB->delete_records('local_ai_assistant_items');

        $second = $this->publish('forum');

        $this->assertFalse($second['created']);
        $this->assertSame($first['cmid'], $second['cmid']);
        $this->assertEquals(1, $DB->count_records('forum', ['course' => $this->course->id]));
        $this->assertEquals(1, $DB->count_records('local_ai_assistant_items', ['itemuuid' => self::ITEM]));
    }

    /**
     * If the teacher deleted the activity in Moodle, publishing the item creates it again.
     */
    public function test_recreates_an_activity_deleted_in_moodle(): void {
        global $DB;

        $first = $this->publish('page');
        course_delete_module($first['cmid']);

        $second = $this->publish('page');

        $this->assertTrue($second['created']);
        $this->assertNotEquals($first['cmid'], $second['cmid']);
        $this->assertEquals(1, $DB->count_records('local_ai_assistant_items', ['itemuuid' => self::ITEM]));
    }

    /**
     * The due date is the end of the day in the teacher's time zone.
     */
    public function test_due_date_uses_the_teachers_time_zone(): void {
        global $DB;

        $expected = make_timestamp(2026, 12, 4, 23, 59, 0, 'America/Guayaquil');

        $assign = $this->publish('assign', '44444444-4444-4444-8444-444444444444', ['duedate' => '2026-12-04']);
        $forum = $this->publish('forum', '55555555-5555-4555-8555-555555555555', ['duedate' => '2026-12-04']);
        $quiz = $this->publish('quiz', '66666666-6666-4666-8666-666666666666', ['duedate' => '2026-12-04']);

        $this->assertEquals($expected, $DB->get_field('assign', 'duedate', ['course' => $this->course->id]));
        $this->assertEquals($expected, $DB->get_field('forum', 'duedate', ['course' => $this->course->id]));
        $this->assertEquals($expected, $DB->get_field('quiz', 'timeclose', ['course' => $this->course->id]));
        $this->assertTrue($assign['created'] && $forum['created'] && $quiz['created']);
    }

    /**
     * Without a date, nothing is invented.
     */
    public function test_no_date_means_no_due_date(): void {
        global $DB;

        $this->publish('assign');

        $this->assertEquals(0, $DB->get_field('assign', 'duedate', ['course' => $this->course->id]));
    }

    /**
     * Impossible and badly formatted dates are rejected before anything is created.
     *
     * @param string $date
     * @dataProvider invalid_dates_provider
     */
    #[\PHPUnit\Framework\Attributes\DataProvider('invalid_dates_provider')]
    public function test_rejects_invalid_dates(string $date): void {
        global $DB;

        try {
            $this->publish('assign', self::ITEM, ['duedate' => $date]);
            $this->fail('The date must be rejected.');
        } catch (\invalid_parameter_exception $exception) {
            $this->assertStringContainsString('duedate', $exception->debuginfo);
        }

        $this->assertEquals(0, $DB->count_records('assign', ['course' => $this->course->id]));
        $this->assertEquals(0, $DB->count_records('local_ai_assistant_items'));
    }

    /**
     * Dates that are not YYYY-MM-DD or do not exist.
     *
     * @return array
     */
    public static function invalid_dates_provider(): array {
        return [
            'not a date' => ['mañana'],
            'wrong order' => ['04-12-2026'],
            'month 13' => ['2026-13-01'],
            'day 31 of a short month' => ['2026-02-31'],
        ];
    }

    /**
     * The description is shown as text, and a long name is cut to what Moodle stores.
     */
    public function test_cleans_text(): void {
        global $DB;

        $result = $this->publish('assign', self::ITEM, [
            'name' => str_repeat('N', 300),
            'intro' => "Línea 1\n<script>alert(1)</script>",
        ]);

        $assign = $DB->get_record('assign', ['course' => $this->course->id], '*', MUST_EXIST);
        $this->assertSame(255, \core_text::strlen($assign->name));
        $this->assertStringContainsString("Línea 1<br>\n&lt;script&gt;", $assign->intro);
        $this->assertStringNotContainsString('<script>', $assign->intro);
        $this->assertTrue($result['created']);
    }

    /**
     * A label shows its description, so an item without one still gets its title as text.
     */
    public function test_a_label_without_description_shows_its_title(): void {
        global $DB;

        $this->publish('label', self::ITEM, ['name' => 'Bienvenida']);

        $this->assertStringContainsString('Bienvenida', $DB->get_field('label', 'intro', ['course' => $this->course->id]));
    }

    /**
     * A page shows its description as content.
     */
    public function test_a_page_has_the_description_as_content(): void {
        global $DB;

        $this->publish('page', self::ITEM, ['name' => 'Lectura', 'intro' => 'Capítulo 1']);

        $this->assertStringContainsString('Capítulo 1', $DB->get_field('page', 'content', ['course' => $this->course->id]));
    }

    /**
     * Kinds that are not on the list are rejected.
     */
    public function test_rejects_unknown_kinds(): void {
        global $DB;

        $modules = $DB->count_records('course_modules', ['course' => $this->course->id]);

        try {
            $this->publish('chat');
            $this->fail('Only the listed kinds are created.');
        } catch (\invalid_parameter_exception $exception) {
            $this->assertStringContainsString('modname', $exception->debuginfo);
        }

        $this->assertEquals($modules, $DB->count_records('course_modules', ['course' => $this->course->id]));
    }

    /**
     * A teacher without editing rights cannot publish, and nothing is created (permission test).
     */
    public function test_a_teacher_without_editing_rights_is_denied(): void {
        global $DB;

        $helper = $this->getDataGenerator()->create_and_enrol($this->course, 'teacher');
        $modules = $DB->count_records('course_modules', ['course' => $this->course->id]);

        try {
            $this->publish('assign', self::ITEM, ['teacher' => $helper]);
            $this->fail('A non-editing teacher must not publish.');
        } catch (\required_capability_exception $exception) {
            $this->assertSame('nopermissions', $exception->errorcode);
        }

        $this->assertEquals($modules, $DB->count_records('course_modules', ['course' => $this->course->id]));
        $this->assertEquals(0, $DB->count_records('local_ai_assistant_items'));
    }

    /**
     * A section of another course cannot be used, even by a teacher of both.
     */
    public function test_rejects_a_section_of_another_course(): void {
        global $DB;

        $other = $this->getDataGenerator()->create_course();
        $othersection = $DB->get_record('course_sections', ['course' => $other->id, 'section' => 0], '*', MUST_EXIST);

        $this->expectException(\invalid_parameter_exception::class);

        $this->publish('assign', self::ITEM, ['sectionid' => (int) $othersection->id]);
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
     * The activity is created with the teacher's rights, and the integration user is back afterwards.
     */
    public function test_acts_as_the_teacher_and_restores_the_integration_user(): void {
        global $DB, $USER;

        $result = $this->publish('forum');

        $this->assertEquals($this->integration->id, $USER->id);
        $event = $DB->get_record('logstore_standard_log', [
            'eventname' => '\core\event\course_module_created',
            'objectid' => $result['cmid'],
        ]);
        if ($event) {
            $this->assertEquals($this->teacher->id, $event->userid);
        }
    }

    /**
     * The identity is restored even when creating the activity fails.
     */
    public function test_restores_the_integration_user_after_a_failure(): void {
        global $USER;

        try {
            $this->publish('assign', self::ITEM, ['sectionid' => 999999]);
        } catch (\Throwable $exception) {
            $this->assertNotNull($exception);
        }

        $this->assertEquals($this->integration->id, $USER->id);
    }
}
