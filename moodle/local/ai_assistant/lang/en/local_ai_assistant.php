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

/**
 * English strings for local_ai_assistant.
 *
 * @package    local_ai_assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$string['ai_assistant:checkaccess'] = 'Check what other users may do with the AI assistant (integration only)';
$string['ai_assistant:publish'] = 'Publish AI-generated course structures';
$string['ai_assistant:use'] = 'Use the AI teaching assistant';
$string['ai_assistant:viewanalytics'] = 'View AI assistant analytics and student evidence';
$string['ainotice'] = 'This assistant uses artificial intelligence. Its suggestions require your review before you act on them.';
$string['assistant'] = 'AI assistant';
$string['backendnotconfigured'] = 'The backend URL is not configured. Ask the site administrator to complete the plugin settings.';
$string['backendurl'] = 'Backend URL';
$string['backendurl_desc'] = 'Base URL of the Smart LMS backend API, including the /api/v1 prefix. The browser calls this URL, so it must be reachable from the computers of the users and allowed in CORS_ORIGINS of the backend.';
$string['cappublish'] = 'Publish course structures';
$string['capuse'] = 'Use the assistant';
$string['capviewanalytics'] = 'View analytics';
$string['connected'] = 'Connected to the backend. Your permissions in this course:';
$string['connecting'] = 'Connecting to the backend…';
$string['connection'] = 'Backend connection';
$string['connectionerror'] = 'Could not connect to the backend ({$a}).';
$string['jwtsecret'] = 'JWT signing secret';
$string['jwtsecret_desc'] = 'Shared secret used to sign short-lived tokens for the backend. It must match PLUGIN_JWT_SECRET in the backend and be at least 32 characters long.';
$string['jwtsecretmissing'] = 'The JWT signing secret is not configured or is shorter than 32 characters.';
$string['pluginname'] = 'AI teaching assistant';
$string['privacy:metadata:backend'] = 'The Smart LMS backend processes course information to plan courses, answer questions and suggest teaching strategies.';
$string['privacy:metadata:backend:courseid'] = 'The ID of the course in which the assistant is used.';
$string['privacy:metadata:backend:message'] = 'Questions written by the teacher in the assistant chat.';
$string['privacy:metadata:backend:syllabus'] = 'Syllabus files uploaded by the teacher.';
$string['privacy:metadata:backend:userid'] = 'The ID of the user who uses the assistant.';
