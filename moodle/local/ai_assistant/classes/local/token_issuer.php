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
use moodle_exception;

/**
 * Issues short-lived JWTs that identify a Moodle user and course to the Smart LMS backend (ADR-006).
 *
 * Each token is single use: the backend rejects a repeated jti. The token only identifies the caller;
 * the backend still asks Moodle for the user's capabilities (ADR-007).
 *
 * @package    local_ai_assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class token_issuer {
    /** Token lifetime in seconds. The backend rejects tokens that live longer. */
    public const LIFETIME = 300;

    /** Audience expected by the backend. */
    public const AUDIENCE = 'smart-lms-api';

    /** Minimum length of the shared secret, matching PLUGIN_JWT_SECRET validation in the backend. */
    public const MIN_SECRET_LENGTH = 32;

    /**
     * Creates a signed token for a user acting in a course.
     *
     * @param int $userid Moodle user id.
     * @param int $courseid Moodle course id.
     * @param int|null $now Current time, for tests.
     * @return array{token: string, expiresat: int}
     * @throws moodle_exception If the signing secret is not configured.
     */
    public static function issue(int $userid, int $courseid, ?int $now = null): array {
        global $CFG;

        $secret = (string) get_config('local_ai_assistant', 'jwtsecret');
        if (\core_text::strlen($secret) < self::MIN_SECRET_LENGTH) {
            throw new moodle_exception('jwtsecretmissing', 'local_ai_assistant');
        }

        $now = $now ?? time();
        $payload = [
            'iss' => $CFG->wwwroot,
            'aud' => self::AUDIENCE,
            'sub' => (string) $userid,
            'courseid' => $courseid,
            'iat' => $now,
            'exp' => $now + self::LIFETIME,
            'jti' => bin2hex(random_bytes(16)),
        ];

        return [
            'token' => JWT::encode($payload, $secret, 'HS256'),
            'expiresat' => $payload['exp'],
        ];
    }
}
