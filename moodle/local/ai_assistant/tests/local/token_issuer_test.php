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

use Firebase\JWT\JWT;
use Firebase\JWT\Key;

/**
 * Tests for the backend token issuer.
 *
 * @package    local_ai_assistant
 * @category   test
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
#[\PHPUnit\Framework\Attributes\CoversClass(token_issuer::class)]
final class token_issuer_test extends \advanced_testcase {
    /** Secret used by the tests. */
    private const SECRET = 'test-secret-with-at-least-32-characters!';

    public function test_issue_signs_expected_claims(): void {
        global $CFG;
        $this->resetAfterTest();
        set_config('jwtsecret', self::SECRET, 'local_ai_assistant');

        $issued = token_issuer::issue(42, 7, 1000);
        JWT::$timestamp = 1000;
        $claims = (array) JWT::decode($issued['token'], new Key(self::SECRET, 'HS256'));
        JWT::$timestamp = null;

        $this->assertSame($CFG->wwwroot, $claims['iss']);
        $this->assertSame(token_issuer::AUDIENCE, $claims['aud']);
        $this->assertSame('42', $claims['sub']);
        $this->assertSame(7, $claims['courseid']);
        $this->assertSame(1000, $claims['iat']);
        $this->assertSame(1000 + token_issuer::LIFETIME, $claims['exp']);
        $this->assertSame($claims['exp'], $issued['expiresat']);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{32}$/', $claims['jti']);
    }

    public function test_issue_uses_a_new_jti_each_time(): void {
        $this->resetAfterTest();
        set_config('jwtsecret', self::SECRET, 'local_ai_assistant');

        $first = JWT::jsonDecode(JWT::urlsafeB64Decode(explode('.', token_issuer::issue(1, 1)['token'])[1]));
        $second = JWT::jsonDecode(JWT::urlsafeB64Decode(explode('.', token_issuer::issue(1, 1)['token'])[1]));

        $this->assertNotSame($first->jti, $second->jti);
    }

    public function test_issue_fails_without_a_long_enough_secret(): void {
        $this->resetAfterTest();
        set_config('jwtsecret', 'short', 'local_ai_assistant');

        $this->expectException(\moodle_exception::class);
        $this->expectExceptionMessage(get_string('jwtsecretmissing', 'local_ai_assistant'));
        token_issuer::issue(1, 1);
    }
}
