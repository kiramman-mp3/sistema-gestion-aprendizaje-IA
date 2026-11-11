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
 * Crea cursos de prueba adicionales para probar el asistente con grupos de estudiantes distintos.
 *
 * Complementa a seed_curso_prueba.php (AN-401-PRUEBA). Cada curso tiene su propia mezcla de entregas, notas y accesos,
 * de modo que la analítica, el chat y las señales de dificultad muestren cosas diferentes:
 *
 * - RD-301-PRUEBA: Redes de Computadores. Grupo sólido, con pocas señales de dificultad.
 * - GP-302-PRUEBA: Gestión de Proyectos. Muchas entregas tardías y varias sin calificar.
 * - ME-201-PRUEBA: Métodos Numéricos. Grupo con notas bajas, un cuestionario muy difícil y varios inactivos.
 * - LI-101-PRUEBA: Lógica de Programación. Curso vacío (solo la sección General) para probar de principio a fin la
 *   subida del sílabo, la propuesta y la publicación.
 *
 * Los estudiantes son prueba_est01 a prueba_est12 (se crean si faltan) y el docente es prueba_docente. Los datos son
 * deterministas, no contienen datos reales y los plazos son relativos a hoy.
 *
 * Uso (dentro del contenedor webserver):
 *   php /opt/smart-lms/cli/seed_cursos_prueba.php [--password=Demo#2026] [--recrear]
 *
 * Con --recrear borra los cursos que ya existan con esos nombres cortos y los vuelve a crear. Sin esa opción, si
 * alguno existe, el script se detiene sin cambiar nada.
 *
 * @package    local_ai_assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

define('CLI_SCRIPT', true);

require('/var/www/html/config.php');
require_once($CFG->libdir . '/clilib.php');
require_once($CFG->libdir . '/gradelib.php');
require_once($CFG->libdir . '/testing/generator/lib.php');
require_once($CFG->libdir . '/completionlib.php');
require_once($CFG->dirroot . '/course/lib.php');
require_once($CFG->dirroot . '/mod/assign/locallib.php');
require_once($CFG->dirroot . '/mod/quiz/lib.php');

[$options] = cli_get_params(['password' => 'Demo#2026', 'recrear' => false, 'help' => false], ['h' => 'help']);
if ($options['help']) {
    cli_writeln('php seed_cursos_prueba.php [--password=Demo#2026] [--recrear]');
    exit(0);
}

// Estados de entrega de cada tarea, uno por estudiante (1 a 12):
// O = a tiempo y calificada, o = a tiempo sin calificar, L = tarde y calificada, l = tarde sin calificar,
// D = borrador (no se envió), N = sin entrega.
//
// `base` es la nota de cada estudiante en el curso (0 = sin nota) y `offset` la ajusta por tarea. `lastaccess` son los
// días desde el último ingreso al curso de cada estudiante; los que no aparecen no ingresaron nunca.
$specs = [
    [
        'shortname' => 'RD-301-PRUEBA',
        'fullname' => 'Redes de Computadores (curso de prueba)',
        'sections' => ['Fundamentos de redes', 'Capa de enlace', 'Capa de red', 'Transporte y aplicación'],
        'students' => 12,
        'base' => [
            1 => 9.4, 2 => 9.0, 3 => 8.8, 4 => 8.2, 5 => 7.9, 6 => 7.5, 7 => 7.2, 8 => 6.8, 9 => 6.5,
            10 => 6.2, 11 => 0, 12 => 7.0,
        ],
        'assignments' => [
            [
                'name' => 'Laboratorio 1: Direccionamiento IP', 'section' => 1, 'due' => -30,
                'states' => 'OOOOOOOOOONO', 'offset' => 0.3,
            ],
            [
                'name' => 'Laboratorio 2: Conmutación y VLAN', 'section' => 2, 'due' => -14,
                'states' => 'OOOOOOOLOONN', 'offset' => 0,
            ],
            ['name' => 'Laboratorio 3: Enrutamiento', 'section' => 3, 'due' => 6, 'states' => 'oooooDoDNNNN', 'offset' => 0],
        ],
        'quiz' => [
            'name' => 'Cuestionario 1: Modelo OSI y TCP/IP', 'section' => 1, 'closed' => -20,
            'offset' => -0.4, 'students' => 11,
        ],
        'forum' => ['name' => 'Foro: dudas de direccionamiento', 'section' => 1, 'completed' => [1, 2, 3, 4, 5, 6, 8, 9]],
        'page' => ['name' => 'Lectura: protocolos de transporte', 'section' => 4, 'completed' => [1, 2, 3, 5]],
        'label' => ['name' => 'Aviso: laboratorio presencial el viernes', 'section' => 3],
        'lastaccess' => [1 => 0, 2 => 0, 3 => 1, 4 => 1, 5 => 2, 6 => 2, 7 => 3, 8 => 4, 9 => 6, 10 => 8, 12 => 5],
    ],
    [
        'shortname' => 'GP-302-PRUEBA',
        'fullname' => 'Gestión de Proyectos (curso de prueba)',
        'sections' => ['Inicio y alcance', 'Planificación', 'Ejecución y control', 'Cierre'],
        'students' => 12,
        'base' => [
            1 => 8.5, 2 => 8.0, 3 => 7.5, 4 => 7.2, 5 => 6.8, 6 => 6.5, 7 => 6.0, 8 => 5.6, 9 => 5.0,
            10 => 4.5, 11 => 0, 12 => 6.2,
        ],
        'assignments' => [
            [
                'name' => 'Entrega 1: Acta de constitución', 'section' => 1, 'due' => -28,
                'states' => 'OOLLLLLLOLNL', 'offset' => 0.2,
            ],
            [
                'name' => 'Entrega 2: Cronograma y presupuesto', 'section' => 2, 'due' => -12,
                'states' => 'OLLLLlllLlNN', 'offset' => -0.3,
            ],
            ['name' => 'Entrega 3: Matriz de riesgos', 'section' => 3, 'due' => -3, 'states' => 'ooooooollNNN', 'offset' => 0],
            ['name' => 'Entrega 4: Informe de cierre', 'section' => 4, 'due' => 10, 'states' => 'oDDNNNNNNNNN', 'offset' => 0],
        ],
        'quiz' => [
            'name' => 'Cuestionario 1: Metodologías de gestión', 'section' => 1, 'closed' => -18,
            'offset' => 0, 'students' => 11,
        ],
        'forum' => ['name' => 'Foro: casos de proyectos fallidos', 'section' => 3, 'completed' => [1, 2, 3, 4, 7, 8]],
        'page' => ['name' => 'Lectura: guía de buenas prácticas', 'section' => 2, 'completed' => [1, 2, 3, 4, 5, 6, 7, 8, 9]],
        'label' => ['name' => 'Aviso: se aceptan entregas tardías con descuento', 'section' => 2],
        'lastaccess' => [1 => 1, 2 => 1, 3 => 2, 4 => 3, 5 => 4, 6 => 7, 7 => 9, 8 => 12, 9 => 17, 10 => 22, 12 => 6],
    ],
    [
        'shortname' => 'ME-201-PRUEBA',
        'fullname' => 'Métodos Numéricos (curso de prueba)',
        'sections' => ['Errores y aritmética', 'Raíces de ecuaciones', 'Sistemas lineales', 'Interpolación e integración'],
        'students' => 12,
        'base' => [
            1 => 7.8, 2 => 7.0, 3 => 6.4, 4 => 5.8, 5 => 5.2, 6 => 4.6, 7 => 4.0, 8 => 3.5, 9 => 3.0,
            10 => 2.5, 11 => 0, 12 => 4.8,
        ],
        'assignments' => [
            [
                'name' => 'Taller 1: Propagación de errores', 'section' => 1, 'due' => -26,
                'states' => 'OOOOOOOLONNO', 'offset' => 0.4,
            ],
            [
                'name' => 'Taller 2: Método de Newton-Raphson', 'section' => 2, 'due' => -13,
                'states' => 'OOOOOLLNNNNN', 'offset' => -0.2,
            ],
            ['name' => 'Taller 3: Eliminación gaussiana', 'section' => 3, 'due' => -2, 'states' => 'ooooooNNNNNN', 'offset' => 0],
        ],
        'quiz' => [
            'name' => 'Cuestionario 1: Series de Taylor', 'section' => 1, 'closed' => -15, 'offset' => -1.8,
            'students' => 9,
        ],
        'forum' => ['name' => 'Foro: dudas sobre convergencia', 'section' => 2, 'completed' => [1, 2, 3]],
        'page' => ['name' => 'Lectura: pivoteo parcial', 'section' => 3, 'completed' => [1, 2]],
        'label' => ['name' => 'Aviso: tutoría de refuerzo los martes', 'section' => 3],
        'lastaccess' => [1 => 2, 2 => 3, 3 => 5, 4 => 8, 5 => 15, 6 => 18, 7 => 21, 8 => 26, 9 => 30, 12 => 11],
    ],
    [
        'shortname' => 'LI-101-PRUEBA',
        'fullname' => 'Lógica de Programación (curso vacío de prueba)',
        'sections' => [],
        'students' => 8,
        'base' => [],
        'assignments' => [],
        'quiz' => null,
        'forum' => null,
        'page' => null,
        'label' => null,
        'lastaccess' => [],
    ],
];

\core\session\manager::set_user(get_admin());

$existing = [];
foreach ($specs as $spec) {
    $found = $DB->get_record('course', ['shortname' => $spec['shortname']]);
    if ($found) {
        $existing[] = $found;
    }
}
if ($existing && !$options['recrear']) {
    cli_error('Ya existen: ' . implode(', ', array_column($existing, 'shortname')) .
        '. Usa --recrear para borrarlos y crearlos de nuevo.');
}
foreach ($existing as $found) {
    delete_course($found, false);
    cli_writeln('Curso anterior eliminado: ' . $found->shortname . '.');
}

$generator = new testing_data_generator();
/** @var mod_assign_generator $assigngenerator */
$assigngenerator = $generator->get_plugin_generator('mod_assign');
$now = time();
$day = DAYSECS;

// Personas: las mismas de AN-401-PRUEBA, que se crean si faltan.
$teacher = $DB->get_record('user', ['username' => 'prueba_docente'])
    ?: $generator->create_user([
        'username' => 'prueba_docente', 'password' => $options['password'],
        'firstname' => 'Marcela', 'lastname' => 'Docente Prueba', 'email' => 'prueba_docente@example.com',
    ]);
$firstnames = ['Carla', 'Andrés', 'Beatriz', 'Diego', 'Elena', 'Fabián', 'Gloria', 'Hugo', 'Irene', 'Julián', 'Karla', 'Mateo'];
$students = [];
foreach ($firstnames as $i => $first) {
    $username = sprintf('prueba_est%02d', $i + 1);
    $students[$i + 1] = $DB->get_record('user', ['username' => $username])
        ?: $generator->create_user([
            'username' => $username, 'password' => $options['password'],
            'firstname' => $first, 'lastname' => sprintf('Prueba %02d', $i + 1), 'email' => "{$username}@example.com",
        ]);
}

/**
 * Nota de un estudiante en una actividad: su nota base más el ajuste de la actividad, entre 0 y 10.
 *
 * @param array $spec Especificación del curso.
 * @param int $number Número del estudiante (1 a 12).
 * @param float $offset Ajuste de la actividad.
 * @return float
 */
function seed_nota(array $spec, int $number, float $offset): float {
    return round(max(0.5, min(10, $spec['base'][$number] + $offset)), 1);
}

$report = [];
foreach ($specs as $spec) {
    $course = $generator->create_course([
        'shortname' => $spec['shortname'],
        'fullname' => $spec['fullname'],
        'numsections' => count($spec['sections']),
        'enablecompletion' => 1,
    ]);
    foreach ($spec['sections'] as $index => $name) {
        $DB->set_field('course_sections', 'name', $name, ['course' => $course->id, 'section' => $index + 1]);
    }
    $generator->enrol_user($teacher->id, $course->id, 'editingteacher');
    for ($number = 1; $number <= $spec['students']; $number++) {
        $generator->enrol_user($students[$number]->id, $course->id, 'student');
    }

    $completion = new completion_info($course);
    $completed = []; // Por cmid: ids de estudiantes que completaron la actividad.

    foreach ($spec['assignments'] as $item) {
        $duedate = $now + $item['due'] * $day;
        $instance = $assigngenerator->create_instance([
            'course' => $course->id,
            'name' => $item['name'],
            'section' => $item['section'],
            'duedate' => $duedate,
            'allowsubmissionsfromdate' => $duedate - 21 * $day,
            'submissiondrafts' => 1,
            'requiresubmissionstatement' => 0,
            'assignsubmission_onlinetext_enabled' => 1,
            'grade' => 10,
            'completion' => COMPLETION_TRACKING_MANUAL,
        ]);
        $cm = get_coursemodule_from_instance('assign', $instance->id, $course->id, false, MUST_EXIST);
        $assign = new assign(context_module::instance($cm->id), $cm, $course);

        foreach (str_split($item['states']) as $position => $code) {
            $number = $position + 1;
            if ($code === 'N') {
                continue;
            }
            $assigngenerator->create_submission([
                'userid' => $students[$number]->id,
                'cmid' => $cm->id,
                'onlinetext' => '<p>Entrega sintética del estudiante ' . $number . '.</p>',
            ]);
            if ($code === 'D') {
                $DB->set_field(
                    'assign_submission',
                    'timemodified',
                    $now - $day,
                    ['assignment' => $instance->id, 'userid' => $students[$number]->id]
                );
                continue;
            }
            $assign->submit_for_grading((object) ['userid' => $students[$number]->id], []);
            $late = in_array($code, ['L', 'l'], true);
            $DB->set_field(
                'assign_submission',
                'timemodified',
                $late ? $duedate + 2 * $day : min($now - $day, $duedate - $day),
                ['assignment' => $instance->id, 'userid' => $students[$number]->id]
            );
            $completed[$cm->id][] = $students[$number]->id;
            if (in_array($code, ['O', 'L'], true)) {
                $assign->save_grade($students[$number]->id, (object) [
                    'grade' => seed_nota($spec, $number, $item['offset']),
                    'attemptnumber' => -1,
                    'addattempt' => 0,
                    'applytoall' => 0,
                    'workflowstate' => '',
                ]);
            }
        }
    }

    if ($spec['quiz']) {
        $quiz = $generator->create_module('quiz', [
            'course' => $course->id,
            'name' => $spec['quiz']['name'],
            'section' => $spec['quiz']['section'],
            'grade' => 10,
            'timeclose' => $now + $spec['quiz']['closed'] * $day,
            'completion' => COMPLETION_TRACKING_MANUAL,
        ]);
        for ($number = 1; $number <= $spec['quiz']['students']; $number++) {
            if ($spec['base'][$number] == 0) {
                continue;
            }
            grade_update(
                'mod/quiz',
                $course->id,
                'mod',
                'quiz',
                $quiz->id,
                0,
                [
                    'userid' => $students[$number]->id,
                    'rawgrade' => seed_nota($spec, $number, $spec['quiz']['offset']),
                    'dategraded' => $now + ($spec['quiz']['closed'] + 1) * $day,
                    'datesubmitted' => $now + $spec['quiz']['closed'] * $day,
                ]
            );
            $completed[$quiz->cmid][] = $students[$number]->id;
        }
    }
    if ($spec['forum']) {
        $forum = $generator->create_module('forum', [
            'course' => $course->id,
            'name' => $spec['forum']['name'],
            'section' => $spec['forum']['section'],
            'completion' => COMPLETION_TRACKING_MANUAL,
        ]);
        $completed[$forum->cmid] = array_map(fn($n) => $students[$n]->id, $spec['forum']['completed']);
    }
    if ($spec['page']) {
        $page = $generator->create_module('page', [
            'course' => $course->id,
            'name' => $spec['page']['name'],
            'section' => $spec['page']['section'],
            'completion' => COMPLETION_TRACKING_MANUAL,
        ]);
        $completed[$page->cmid] = array_map(fn($n) => $students[$n]->id, $spec['page']['completed']);
    }
    if ($spec['label']) {
        $generator->create_module('label', [
            'course' => $course->id, 'name' => $spec['label']['name'], 'section' => $spec['label']['section'],
        ]);
    }

    // Finalización: quién completó cada actividad, con una fecha cercana a hoy.
    $modinfo = get_fast_modinfo($course);
    $totalcompleted = 0;
    foreach ($completed as $cmid => $userids) {
        foreach ($userids as $userid) {
            $completion->internal_set_data($modinfo->get_cm($cmid), (object) [
                'id' => 0,
                'userid' => $userid,
                'coursemoduleid' => $cmid,
                'overrideby' => null,
                'completionstate' => COMPLETION_COMPLETE,
                'viewed' => 1,
                'timemodified' => $now - 3 * $day,
            ]);
            $totalcompleted++;
        }
    }

    foreach ($spec['lastaccess'] as $number => $days) {
        $DB->insert_record('user_lastaccess', (object) [
            'userid' => $students[$number]->id,
            'courseid' => $course->id,
            'timeaccess' => $now - $days * $day - 3600,
        ]);
    }

    $report[] = sprintf(
        '%s (id %d) · %s · %d estudiantes, %d secciones, %d tareas%s · %d actividades completadas',
        $spec['shortname'],
        $course->id,
        $spec['fullname'],
        $spec['students'],
        count($spec['sections']),
        count($spec['assignments']),
        $spec['quiz'] ? ', 1 cuestionario' : '',
        $totalcompleted
    );
    rebuild_course_cache($course->id, true);
}

cli_writeln('Cursos de prueba creados:');
foreach ($report as $line) {
    cli_writeln(' - ' . $line);
}
cli_writeln('Docente con permisos: prueba_docente. Estudiantes: prueba_est01 a prueba_est12.');
cli_writeln('Contraseña: ' . $options['password']);
