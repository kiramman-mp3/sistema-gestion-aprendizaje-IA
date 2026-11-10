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
 * Configura la integración del backend en la instancia local de desarrollo.
 *
 * - Activa los servicios web y el protocolo REST.
 * - Crea el rol "Integración Smart LMS" con permisos mínimos y el usuario ai_integration.
 * - Autoriza al usuario en el servicio local_ai_assistant_integration (definido en db/services.php).
 * - Genera un token permanente y lo imprime una sola vez.
 *
 * Es idempotente: si el token ya existe no se regenera, salvo con --rotate.
 *
 * Uso (dentro del contenedor webserver):
 *   php /opt/smart-lms/cli/setup_integration.php [--rotate]
 *
 * @package    local_ai_assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

define('CLI_SCRIPT', true);

require('/var/www/html/config.php');
require_once($CFG->libdir . '/clilib.php');
require_once($CFG->dirroot . '/user/lib.php');

[$options, $unrecognized] = cli_get_params(['rotate' => false, 'help' => false], ['h' => 'help']);
if ($options['help']) {
    cli_writeln('php setup_integration.php [--rotate]');
    exit(0);
}

/** Usuario técnico que usa el backend. */
const SMART_LMS_USERNAME = 'ai_integration';

/** Rol con permisos mínimos asignado en contexto de sistema. */
const SMART_LMS_ROLE = 'smartlmsintegration';

/** Servicio restringido definido en db/services.php del plugin. */
const SMART_LMS_SERVICE = 'local_ai_assistant_integration';

/**
 * Capacidades del rol de integración. Se amplían solo cuando una función del servicio las necesita.
 */
const SMART_LMS_CAPABILITIES = [
    'webservice/rest:use',
    'local/ai_assistant:checkaccess',
    'local/ai_assistant:createcontent',
];

\core\session\manager::set_user(get_admin());
$syscontext = context_system::instance();

// 1. Servicios web y protocolo REST.
set_config('enablewebservices', 1);
\core\plugininfo\webservice::enable_plugin('rest', 1);
\core\plugininfo\auth::enable_plugin('webservice', 1);
cli_writeln('Servicios web y protocolo REST activos.');

// 2. Servicio definido por el plugin.
$service = $DB->get_record('external_services', ['shortname' => SMART_LMS_SERVICE]);
if (!$service) {
    cli_error('No existe el servicio ' . SMART_LMS_SERVICE . '. Instala local_ai_assistant y ejecuta upgrade.php.');
}

// 3. Rol con permisos mínimos, asignable solo en contexto de sistema.
$roleid = $DB->get_field('role', 'id', ['shortname' => SMART_LMS_ROLE]);
if (!$roleid) {
    $roleid = create_role(
        'Integración Smart LMS',
        SMART_LMS_ROLE,
        'Rol del usuario técnico que usa el backend de Smart LMS. Permisos mínimos.'
    );
    set_role_contextlevels($roleid, [CONTEXT_SYSTEM]);
    cli_writeln('Rol creado: ' . SMART_LMS_ROLE);
}
foreach (SMART_LMS_CAPABILITIES as $capability) {
    assign_capability($capability, CAP_ALLOW, $roleid, $syscontext->id, true);
}
$syscontext->mark_dirty();

// 4. Usuario técnico con autenticación "webservice" (no puede iniciar sesión en la web).
$user = $DB->get_record('user', ['username' => SMART_LMS_USERNAME, 'deleted' => 0]);
if (!$user) {
    $userid = user_create_user((object) [
        'username' => SMART_LMS_USERNAME,
        'auth' => 'webservice',
        'password' => generate_password(32),
        'firstname' => 'Integración',
        'lastname' => 'Smart LMS',
        'email' => 'ai_integration@example.com',
        'confirmed' => 1,
        'mnethostid' => $CFG->mnet_localhost_id,
    ]);
    $user = $DB->get_record('user', ['id' => $userid], '*', MUST_EXIST);
    cli_writeln('Usuario creado: ' . SMART_LMS_USERNAME);
}
role_assign($roleid, $user->id, $syscontext->id);

// 5. Usuario autorizado en el servicio restringido.
if (!$DB->record_exists('external_services_users', ['externalserviceid' => $service->id, 'userid' => $user->id])) {
    $DB->insert_record('external_services_users', (object) [
        'externalserviceid' => $service->id,
        'userid' => $user->id,
        'timecreated' => time(),
    ]);
}

// 6. Token permanente.
$existing = $DB->get_records('external_tokens', [
    'userid' => $user->id,
    'externalserviceid' => $service->id,
    'tokentype' => EXTERNAL_TOKEN_PERMANENT,
]);
if ($existing && !$options['rotate']) {
    cli_writeln('El token ya existe. Usa --rotate para generar uno nuevo; el anterior dejará de funcionar.');
    exit(0);
}
foreach ($existing as $token) {
    $DB->delete_records('external_tokens', ['id' => $token->id]);
}

$token = \core_external\util::generate_token(
    EXTERNAL_TOKEN_PERMANENT,
    $service,
    $user->id,
    $syscontext,
    0,
    '',
    'Smart LMS backend'
);

cli_writeln('');
cli_writeln('Token generado. Cópialo en MOODLE_TOKEN del archivo .env (no se volverá a mostrar):');
cli_writeln($token);
