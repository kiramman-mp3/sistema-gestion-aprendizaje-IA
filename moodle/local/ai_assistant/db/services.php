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
 * External functions and services for local_ai_assistant.
 *
 * The backend calls Moodle through the "Smart LMS integration" service with a dedicated integration
 * user. Only the functions listed here are reachable with that token (least privilege).
 *
 * @package    local_ai_assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$functions = [
    // Called from the browser (AJAX, user session). Not part of the integration service.
    'local_ai_assistant_get_backend_token' => [
        'classname' => \local_ai_assistant\external\get_backend_token::class,
        'description' => 'Returns a short-lived token that identifies the current user and course to the backend.',
        'type' => 'read',
        'ajax' => true,
        'loginrequired' => true,
        'capabilities' => 'local/ai_assistant:use',
    ],

    // Called from the browser (AJAX): the names of the students stay in Moodle (ADR-010).
    'local_ai_assistant_get_course_students' => [
        'classname' => \local_ai_assistant\external\get_course_students::class,
        'description' => 'Lists the students of a course with their names, for the analytics screens.',
        'type' => 'read',
        'ajax' => true,
        'loginrequired' => true,
        'capabilities' => 'local/ai_assistant:viewanalytics',
    ],

    // Called from the browser (AJAX): the activities the teacher can relate to syllabus units.
    'local_ai_assistant_get_course_activities' => [
        'classname' => \local_ai_assistant\external\get_course_activities::class,
        'description' => 'Lists the activities of a course, to relate each one to a unit of the syllabus.',
        'type' => 'read',
        'ajax' => true,
        'loginrequired' => true,
        'capabilities' => 'local/ai_assistant:use',
    ],

    // Called by the backend with the integration token (ADR-007).
    'local_ai_assistant_check_access' => [
        'classname' => \local_ai_assistant\external\check_access::class,
        'description' => 'Reports the assistant capabilities of a user in a course.',
        'type' => 'read',
        'ajax' => false,
        'capabilities' => 'local/ai_assistant:checkaccess',
    ],

    // Called by the backend to publish an approved proposal (RF-09, ADR-008).
    'local_ai_assistant_publish_section' => [
        'classname' => \local_ai_assistant\external\publish_section::class,
        'description' => 'Creates the section of an approved proposal item, or returns the one already created for it.',
        'type' => 'write',
        'ajax' => false,
        'capabilities' => 'local/ai_assistant:createcontent',
    ],
    'local_ai_assistant_publish_module' => [
        'classname' => \local_ai_assistant\external\publish_module::class,
        'description' => 'Creates the activity of an approved proposal item, or returns the one already created for it.',
        'type' => 'write',
        'ajax' => false,
        'capabilities' => 'local/ai_assistant:createcontent',
    ],
];

$services = [
    'Smart LMS integration' => [
        'shortname' => 'local_ai_assistant_integration',
        'functions' => [
            'core_webservice_get_site_info',
            'local_ai_assistant_check_access',
            'local_ai_assistant_publish_section',
            'local_ai_assistant_publish_module',
        ],
        'restrictedusers' => 1,
        'enabled' => 1,
        'downloadfiles' => 0,
        'uploadfiles' => 0,
    ],
];
