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
 * Crea los docentes y el administrador de prueba para probar permisos, snapshots, auditoría y reglas.
 *
 * Necesita el curso AN-401-PRUEBA (seed_curso_prueba.php). Es idempotente: lo que ya existe se conserva.
 *
 * - prueba_docente2: docente con edición en AN-401-PRUEBA. Con prueba_docente, sirve para probar que los
 *   snapshots y las conversaciones de un docente no se mezclan con los de otro.
 * - prueba_tutor: docente sin edición (puede ver la analítica, no publicar).
 * - prueba_admin: gestor asignado en el sistema; tiene local/ai_assistant:administer en todos los cursos.
 *
 * Uso (dentro del contenedor webserver):
 *   php /opt/smart-lms/cli/seed_docentes_prueba.php [--password=Demo#2026]
 *
 * @package    local_ai_assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

define('CLI_SCRIPT', true);

require('/var/www/html/config.php');
require_once($CFG->libdir . '/clilib.php');
require_once($CFG->libdir . '/testing/generator/lib.php');

[$options] = cli_get_params(['password' => 'Demo#2026', 'help' => false], ['h' => 'help']);
if ($options['help']) {
    cli_writeln('php seed_docentes_prueba.php [--password=Demo#2026]');
    exit(0);
}

\core\session\manager::set_user(get_admin());

$course = $DB->get_record('course', ['shortname' => 'AN-401-PRUEBA']);
if (!$course) {
    cli_error('No existe el curso AN-401-PRUEBA. Ejecuta primero seed_curso_prueba.php.');
}

$generator = new testing_data_generator();
$people = [
    'prueba_docente2' => ['Lucía', 'Docente Prueba Dos', 'editingteacher'],
    'prueba_tutor' => ['Tomás', 'Tutor Prueba', 'teacher'],
    'prueba_admin' => ['Alicia', 'Administradora Prueba', null],
];

foreach ($people as $username => [$first, $last, $courserole]) {
    $user = $DB->get_record('user', ['username' => $username]);
    $created = false;
    if (!$user) {
        $user = $generator->create_user([
            'username' => $username,
            'password' => $options['password'],
            'firstname' => $first,
            'lastname' => $last,
            'email' => "{$username}@example.com",
        ]);
        $created = true;
    }

    if ($courserole !== null) {
        $context = context_course::instance($course->id);
        if (!is_enrolled($context, $user->id)) {
            $generator->enrol_user($user->id, $course->id, $courserole);
        }
        cli_writeln(sprintf('%s: %s en %s%s', $username, $courserole, $course->shortname, $created ? ' (creado)' : ''));
        continue;
    }

    // El gestor se asigna en el sistema: así tiene las capacidades de gestión en todos los cursos.
    $managerid = $DB->get_field('role', 'id', ['shortname' => 'manager'], MUST_EXIST);
    $syscontext = context_system::instance();
    if (!user_has_role_assignment($user->id, $managerid, $syscontext->id)) {
        role_assign($managerid, $user->id, $syscontext->id);
    }
    cli_writeln(sprintf('%s: gestor en el sistema%s', $username, $created ? ' (creado)' : ''));
}

cli_writeln('Contraseña de los usuarios nuevos: ' . $options['password']);
