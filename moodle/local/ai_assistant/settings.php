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
 * Admin settings for local_ai_assistant.
 *
 * @package    local_ai_assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

if ($hassiteconfig) {
    $settings = new admin_settingpage('local_ai_assistant', new lang_string('pluginname', 'local_ai_assistant'));

    $settings->add(new admin_setting_configtext(
        'local_ai_assistant/backendurl',
        new lang_string('backendurl', 'local_ai_assistant'),
        new lang_string('backendurl_desc', 'local_ai_assistant'),
        'http://localhost:3000/api/v1',
        PARAM_URL
    ));

    // Shared secret used to sign short-lived JWTs for the backend (ADR-006). Never sent to the browser.
    $settings->add(new admin_setting_configpasswordunmask(
        'local_ai_assistant/jwtsecret',
        new lang_string('jwtsecret', 'local_ai_assistant'),
        new lang_string('jwtsecret_desc', 'local_ai_assistant'),
        ''
    ));

    $ADMIN->add('localplugins', $settings);
}
