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
 * Carga datos sintéticos para desarrollo y pruebas. No contiene datos reales.
 *
 * Crea dos cursos con docentes, 12 estudiantes y tareas que cubren todos los estados que el asistente
 * debe distinguir (RF-11): sin entrega, borrador, enviada a tiempo, enviada tarde, y calificada o no.
 * Los resultados son deterministas (semilla fija) para que las preguntas de referencia sean estables.
 *
 * Uso (dentro del contenedor webserver):
 *   php /opt/smart-lms/cli/seed.php [--password=Demo#2026]
 *
 * @package    local_ai_assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

define('CLI_SCRIPT', true);

require('/var/www/html/config.php');
require_once($CFG->libdir . '/clilib.php');
require_once($CFG->libdir . '/testing/generator/lib.php');
require_once($CFG->dirroot . '/mod/assign/locallib.php');

[$options] = cli_get_params(['password' => 'Demo#2026', 'help' => false], ['h' => 'help']);
if ($options['help']) {
    cli_writeln('php seed.php [--password=Demo#2026]');
    exit(0);
}

\core\session\manager::set_user(get_admin());
mt_srand(42);

if ($DB->record_exists('course', ['shortname' => 'IS-501-DEMO'])) {
    cli_error('Los datos sintéticos ya existen (curso IS-501-DEMO). Reinstala Moodle para regenerarlos.');
}

$generator = new testing_data_generator();
/** @var mod_assign_generator $assigngenerator */
$assigngenerator = $generator->get_plugin_generator('mod_assign');
$day = DAYSECS;
$now = time();

// Usuarios. docente3 solo enseña en el segundo curso: sirve para probar el acceso a cursos ajenos (SEC-01).
$users = [];
$people = [
    'docente1' => ['Docente', 'Uno'],
    'docente2' => ['Docente', 'Dos'],
    'docente3' => ['Docente', 'Tres'],
];
for ($i = 1; $i <= 12; $i++) {
    $people[sprintf('estudiante%02d', $i)] = ['Estudiante', sprintf('%02d', $i)];
}
foreach ($people as $username => [$firstname, $lastname]) {
    $users[$username] = $generator->create_user([
        'username' => $username,
        'password' => $options['password'],
        'firstname' => $firstname,
        'lastname' => $lastname,
        'email' => "{$username}@example.com",
    ]);
}
$students = array_filter($users, fn($u) => str_starts_with($u->username, 'estudiante'));

// Tareas por curso. "due" es relativo a hoy en días y "mix" reparte a los estudiantes por estado:
// none = sin entrega, draft = borrador, ontime = enviada a tiempo, late = enviada tarde.
// "graded" indica si se califican todas las entregas enviadas, la mitad ('partial') o ninguna.
$courses = [
    'IS-501-DEMO' => [
        'fullname' => 'Ingeniería de Software (demo)',
        'teachers' => ['docente1' => 'editingteacher', 'docente2' => 'teacher'],
        'students' => array_slice($students, 0, 12, true),
        'assignments' => [
            [
                'name' => 'Tarea 1: Historias de usuario',
                'due' => -14,
                'mix' => ['ontime' => 9, 'late' => 2, 'none' => 1],
                'graded' => true,
            ],
            [
                'name' => 'Tarea 2: Especificación de requisitos',
                'due' => -7,
                'mix' => ['ontime' => 7, 'late' => 2, 'draft' => 1, 'none' => 2],
                'graded' => 'partial',
            ],
            [
                'name' => 'Tarea 3: Diagrama de arquitectura',
                'due' => 5,
                'mix' => ['ontime' => 5, 'draft' => 3, 'none' => 4],
                'graded' => false,
            ],
        ],
    ],
    'BD-301-DEMO' => [
        'fullname' => 'Bases de Datos (demo)',
        'teachers' => ['docente3' => 'editingteacher'],
        'students' => array_slice($students, 0, 8, true),
        'assignments' => [
            [
                'name' => 'Tarea 1: Modelo entidad-relación',
                'due' => -10,
                'mix' => ['ontime' => 6, 'late' => 1, 'none' => 1],
                'graded' => true,
            ],
            [
                'name' => 'Tarea 2: Normalización',
                'due' => 3,
                'mix' => ['ontime' => 3, 'draft' => 2, 'none' => 3],
                'graded' => false,
            ],
        ],
    ],
];

$summary = [];
foreach ($courses as $shortname => $def) {
    $course = $generator->create_course([
        'shortname' => $shortname,
        'fullname' => $def['fullname'],
        'numsections' => 4,
        'enablecompletion' => 1,
    ]);
    foreach ($def['teachers'] as $username => $role) {
        $generator->enrol_user($users[$username]->id, $course->id, $role);
    }
    foreach ($def['students'] as $student) {
        $generator->enrol_user($student->id, $course->id, 'student');
    }

    foreach ($def['assignments'] as $index => $spec) {
        $duedate = $now + $spec['due'] * $day;
        $instance = $assigngenerator->create_instance([
            'course' => $course->id,
            'name' => $spec['name'],
            'section' => $index + 1,
            'duedate' => $duedate,
            'allowsubmissionsfromdate' => $duedate - 21 * $day,
            'submissiondrafts' => 1,
            'requiresubmissionstatement' => 0,
            'assignsubmission_onlinetext_enabled' => 1,
            'grade' => 10,
        ]);
        $cm = get_coursemodule_from_instance('assign', $instance->id, $course->id, false, MUST_EXIST);
        $assign = new assign(context_module::instance($cm->id), $cm, $course);

        // Reparte los estados entre los estudiantes del curso de forma determinista.
        $plan = [];
        foreach ($spec['mix'] as $state => $count) {
            $plan = array_merge($plan, array_fill(0, $count, $state));
        }
        $enrolled = array_values($def['students']);
        $plan = array_pad(array_slice($plan, 0, count($enrolled)), count($enrolled), 'none');

        $counts = ['none' => 0, 'draft' => 0, 'ontime' => 0, 'late' => 0, 'graded' => 0];
        foreach ($enrolled as $i => $student) {
            $state = $plan[$i];
            $counts[$state]++;
            if ($state === 'none') {
                continue;
            }

            // El generador guarda la entrega como borrador porque la tarea exige confirmar el envío.
            $assigngenerator->create_submission([
                'userid' => $student->id,
                'cmid' => $cm->id,
                'onlinetext' => '<p>Entrega sintética de ' . s($student->username) . '.</p>',
            ]);
            if ($state !== 'draft') {
                $assign->submit_for_grading((object) ['userid' => $student->id], []);
            }

            // Fija la fecha de modificación para producir entregas a tiempo o tardías.
            $submitted = $state === 'late' ? $duedate + 2 * $day : min($now, $duedate - $day);
            $DB->set_field(
                'assign_submission',
                'timemodified',
                $submitted,
                ['assignment' => $instance->id, 'userid' => $student->id]
            );

            $grade = $spec['graded'] === true || ($spec['graded'] === 'partial' && $i % 2 === 0);
            if ($state !== 'draft' && $grade) {
                $assign->save_grade($student->id, (object) [
                    'grade' => mt_rand(40, 100) / 10,
                    'attemptnumber' => -1,
                    'addattempt' => 0,
                    'applytoall' => 0,
                    'workflowstate' => '',
                ]);
                $counts['graded']++;
            }
        }
        $summary[] = sprintf(
            '%s · %s · vence %s · sin entrega %d, borrador %d, a tiempo %d, tarde %d, calificadas %d',
            $shortname,
            $spec['name'],
            date('Y-m-d', $duedate),
            $counts['none'],
            $counts['draft'],
            $counts['ontime'],
            $counts['late'],
            $counts['graded']
        );
    }
}

cli_writeln('Datos sintéticos creados. Usuarios: docente1–3, estudiante01–12. Contraseña: ' . $options['password']);
foreach ($summary as $line) {
    cli_writeln(' - ' . $line);
}
