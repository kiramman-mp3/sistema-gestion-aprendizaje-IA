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
 * Crea el curso de prueba AN-401-PRUEBA para probar el asistente de punta a punta con datos sintéticos.
 *
 * Complementa a seed.php: aquel cubre los estados de las tareas; este reúne en un solo curso lo que necesitan
 * las funciones de lectura, el chat y la analítica (RF-11 a RF-14):
 *
 * - 12 estudiantes ficticios con nombres reconocibles (para ver que el chat sustituye los seudónimos).
 * - Tipos de actividad variados: 3 tareas, un foro, un cuestionario, una página y una etiqueta.
 * - Entregas completas, incompletas (borrador y sin entrega), tardías y pendientes de calificar.
 * - Calificaciones con perfiles distintos: alto, medio, con entregas tardías, en descenso y sin actividad.
 * - Finalización de actividades (seguimiento manual) y último acceso al curso, con inactivos y sin ingreso.
 * - Una calificación oculta, que las funciones de lectura no deben devolver.
 *
 * Los datos son deterministas, no contienen datos reales y los plazos son relativos a hoy.
 *
 * Uso (dentro del contenedor webserver):
 *   php /opt/smart-lms/cli/seed_curso_prueba.php [--password=Demo#2026] [--recrear]
 *
 * Con --recrear borra el curso AN-401-PRUEBA y lo vuelve a crear con plazos relativos a hoy. Los usuarios
 * prueba_* se conservan.
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
require_once($CFG->dirroot . '/mod/assign/locallib.php');
require_once($CFG->dirroot . '/mod/quiz/lib.php');

[$options] = cli_get_params(['password' => 'Demo#2026', 'recrear' => false, 'help' => false], ['h' => 'help']);
if ($options['help']) {
    cli_writeln('php seed_curso_prueba.php [--password=Demo#2026] [--recrear]');
    exit(0);
}

const PRUEBA_SHORTNAME = 'AN-401-PRUEBA';

\core\session\manager::set_user(get_admin());

$existing = $DB->get_record('course', ['shortname' => PRUEBA_SHORTNAME]);
if ($existing && !$options['recrear']) {
    cli_error('El curso de prueba ya existe (' . PRUEBA_SHORTNAME . '). Usa --recrear para borrarlo y crearlo de nuevo.');
}
if ($existing) {
    delete_course($existing, false);
    cli_writeln('Curso anterior eliminado.');
}

$generator = new testing_data_generator();
/** @var mod_assign_generator $assigngenerator */
$assigngenerator = $generator->get_plugin_generator('mod_assign');
$now = time();
$day = DAYSECS;

// Personas. El docente ajeno no está matriculado en ningún curso: sirve para probar el rechazo de permisos.
$teacherdata = [
    'prueba_docente' => ['Marcela', 'Docente Prueba'],
    'prueba_ajeno' => ['Ramiro', 'Ajeno Prueba'],
];
$firstnames = ['Carla', 'Andrés', 'Beatriz', 'Diego', 'Elena', 'Fabián', 'Gloria', 'Hugo', 'Irene', 'Julián', 'Karla', 'Mateo'];
$users = [];
foreach ($teacherdata as $username => [$first, $last]) {
    $users[$username] = $DB->get_record('user', ['username' => $username])
        ?: $generator->create_user([
            'username' => $username, 'password' => $options['password'],
            'firstname' => $first, 'lastname' => $last, 'email' => "{$username}@example.com",
        ]);
}
$students = [];
foreach ($firstnames as $i => $first) {
    $username = sprintf('prueba_est%02d', $i + 1);
    $students[$i + 1] = $DB->get_record('user', ['username' => $username])
        ?: $generator->create_user([
            'username' => $username, 'password' => $options['password'],
            'firstname' => $first, 'lastname' => sprintf('Prueba %02d', $i + 1), 'email' => "{$username}@example.com",
        ]);
}

$course = $generator->create_course([
    'shortname' => PRUEBA_SHORTNAME,
    'fullname' => 'Análisis de Datos (curso de prueba del asistente)',
    'numsections' => 5,
    'enablecompletion' => 1,
]);
$generator->enrol_user($users['prueba_docente']->id, $course->id, 'editingteacher');
foreach ($students as $student) {
    $generator->enrol_user($student->id, $course->id, 'student');
}

/**
 * Estados de entrega por estudiante (1 a 12) para cada tarea:
 * O = a tiempo y calificada, o = a tiempo sin calificar, L = tarde y calificada, l = tarde sin calificar,
 * D = borrador (no se envió), N = sin entrega.
 *
 * Perfiles: 01-03 altos; 04-06 medios; 07-08 entregan tarde; 09-10 bajan de nota y faltan entregas;
 * 11 no participa; 12 irregular.
 */
$assignments = [
    [
        'name' => 'Tarea 1: Limpieza de datos',
        'due' => -21,
        'section' => 1,
        'states' => 'OOOOOOLLOONO',
        'grades' => [1 => 9.5, 2 => 9.0, 3 => 9.8, 4 => 7.5, 5 => 7.0, 6 => 6.8, 7 => 6.0, 8 => 5.5, 9 => 6.5, 10 => 6.0, 12 => 7.2],
    ],
    [
        'name' => 'Tarea 2: Análisis exploratorio',
        'due' => -10,
        'section' => 2,
        'states' => 'OOOOOLLlNONN',
        'grades' => [1 => 9.0, 2 => 9.5, 3 => 9.4, 4 => 7.2, 5 => 7.8, 6 => 6.0, 7 => 5.0, 10 => 3.8],
    ],
    [
        'name' => 'Tarea 3: Visualización',
        'due' => 4,
        'section' => 3,
        'states' => 'ooDoDNNNNDNN',
        'grades' => [],
    ],
];

$completion = new completion_info($course);
$summary = [];
$completed = []; // Por cmid: ids de estudiantes que completaron la actividad.

foreach ($assignments as $spec) {
    $duedate = $now + $spec['due'] * $day;
    $instance = $assigngenerator->create_instance([
        'course' => $course->id,
        'name' => $spec['name'],
        'section' => $spec['section'],
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
    $count = ['none' => 0, 'draft' => 0, 'submitted' => 0, 'late' => 0, 'graded' => 0, 'pending' => 0];

    foreach (str_split($spec['states']) as $offset => $code) {
        $number = $offset + 1;
        $student = $students[$number];
        if ($code === 'N') {
            $count['none']++;
            continue;
        }
        $assigngenerator->create_submission([
            'userid' => $student->id,
            'cmid' => $cm->id,
            'onlinetext' => '<p>Entrega sintética del estudiante ' . $number . '.</p>',
        ]);
        if ($code === 'D') {
            $count['draft']++;
            $DB->set_field('assign_submission', 'timemodified', $now - $day, ['assignment' => $instance->id, 'userid' => $student->id]);
            continue;
        }
        $assign->submit_for_grading((object) ['userid' => $student->id], []);
        $late = in_array($code, ['L', 'l'], true);
        $DB->set_field(
            'assign_submission',
            'timemodified',
            $late ? $duedate + 2 * $day : min($now - $day, $duedate - $day),
            ['assignment' => $instance->id, 'userid' => $student->id]
        );
        $count[$late ? 'late' : 'submitted']++;
        $completed[$cm->id][] = $student->id;

        if (in_array($code, ['O', 'L'], true)) {
            $assign->save_grade($student->id, (object) [
                'grade' => $spec['grades'][$number],
                'attemptnumber' => -1,
                'addattempt' => 0,
                'applytoall' => 0,
                'workflowstate' => '',
            ]);
            $count['graded']++;
        } else {
            $count['pending']++;
        }
    }
    $summary[] = sprintf(
        '%s · vence %s · sin entrega %d, borrador %d, a tiempo %d, tarde %d, calificadas %d, pendientes %d',
        $spec['name'],
        date('Y-m-d', $duedate),
        $count['none'],
        $count['draft'],
        $count['submitted'],
        $count['late'],
        $count['graded'],
        $count['pending']
    );
}

// Cuestionario con notas puestas por el libro de calificaciones (no se simulan intentos). Estudiante 04: nota oculta.
$quiz = $generator->create_module('quiz', [
    'course' => $course->id,
    'name' => 'Cuestionario 1: Conceptos de estadística',
    'section' => 4,
    'grade' => 10,
    'timeclose' => $now - 5 * $day,
    'completion' => COMPLETION_TRACKING_MANUAL,
]);
$quizgrades = [1 => 9.0, 2 => 8.5, 3 => 10.0, 4 => 7.0, 5 => 6.5, 6 => 5.5, 7 => 6.0, 8 => 4.5, 9 => 3.5, 10 => 3.0];
foreach ($quizgrades as $number => $grade) {
    grade_update(
        'mod/quiz',
        $course->id,
        'mod',
        'quiz',
        $quiz->id,
        0,
        ['userid' => $students[$number]->id, 'rawgrade' => $grade, 'dategraded' => $now - 4 * $day, 'datesubmitted' => $now - 5 * $day]
    );
    $completed[$quiz->cmid][] = $students[$number]->id;
}
$item = grade_item::fetch(['courseid' => $course->id, 'itemtype' => 'mod', 'itemmodule' => 'quiz', 'iteminstance' => $quiz->id, 'itemnumber' => 0]);
$hidden = grade_grade::fetch(['itemid' => $item->id, 'userid' => $students[4]->id]);
$hidden->set_hidden(1);
$summary[] = 'Cuestionario 1 · 10 calificaciones; la del estudiante 04 está oculta y no debe salir en las lecturas';

// Foro, página y etiqueta: actividades sin calificación para probar los tipos de actividad.
$forum = $generator->create_module('forum', [
    'course' => $course->id,
    'name' => 'Foro: dudas de la unidad 1',
    'section' => 1,
    'duedate' => $now + 6 * $day,
    'completion' => COMPLETION_TRACKING_MANUAL,
]);
$completed[$forum->cmid] = array_map(fn($n) => $students[$n]->id, [1, 2, 3, 4, 5, 7]);
$page = $generator->create_module('page', [
    'course' => $course->id,
    'name' => 'Lectura: introducción a la visualización',
    'section' => 3,
    'completion' => COMPLETION_TRACKING_MANUAL,
]);
$completed[$page->cmid] = array_map(fn($n) => $students[$n]->id, [1, 2, 3, 4, 5, 6, 9]);
$generator->create_module('label', ['course' => $course->id, 'name' => 'Aviso: semana de repaso', 'section' => 5]);

// Finalización: quién completó cada actividad, con una fecha cercana a la entrega.
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
$summary[] = sprintf('Finalización · %d actividades completadas en total (seguimiento manual)', $totalcompleted);

// Último acceso al curso, en días atrás. Los estudiantes 08 a 10 llevan más de dos semanas sin entrar y el 11 nunca entró.
$daysago = [1 => 0, 2 => 1, 3 => 2, 4 => 3, 5 => 5, 6 => 6, 7 => 9, 8 => 16, 9 => 20, 10 => 25, 12 => 2];
foreach ($daysago as $number => $days) {
    $DB->insert_record('user_lastaccess', (object) [
        'userid' => $students[$number]->id,
        'courseid' => $course->id,
        'timeaccess' => $now - $days * $day - 3600,
    ]);
}
$summary[] = 'Último acceso · 11 estudiantes con acceso (3 con más de 14 días) y el 11 sin ingresar nunca';

cli_writeln('Curso de prueba creado: ' . PRUEBA_SHORTNAME . ' (id ' . $course->id . ').');
cli_writeln('Docente con permisos: prueba_docente. Docente sin acceso al curso: prueba_ajeno. Estudiantes: prueba_est01 a prueba_est12.');
cli_writeln('Contraseña: ' . $options['password']);
foreach ($summary as $line) {
    cli_writeln(' - ' . $line);
}
