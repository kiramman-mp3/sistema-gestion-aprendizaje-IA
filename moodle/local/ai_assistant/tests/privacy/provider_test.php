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

namespace local_ai_assistant\privacy;

use core_privacy\local\metadata\collection;
use core_privacy\local\metadata\types\external_location;

/**
 * Tests for the local_ai_assistant privacy provider.
 *
 * @package    local_ai_assistant
 * @category   test
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 * @covers     \local_ai_assistant\privacy\provider
 */
final class provider_test extends \core_privacy\tests\provider_testcase {
    public function test_metadata_declares_backend_as_external_location(): void {
        $collection = provider::get_metadata(new collection('local_ai_assistant'));
        $items = $collection->get_collection();

        $this->assertCount(1, $items);
        $this->assertInstanceOf(external_location::class, $items[0]);
        $this->assertSame('smart_lms_backend', $items[0]->get_name());
        $this->assertArrayHasKey('message', $items[0]->get_privacy_fields());
    }

    public function test_no_user_data_is_stored_in_moodle(): void {
        $this->resetAfterTest();
        $user = $this->getDataGenerator()->create_user();

        $this->assertEmpty(provider::get_contexts_for_userid($user->id)->get_contextids());
    }
}
