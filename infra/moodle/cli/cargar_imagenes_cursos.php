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
 * Carga la imagen de portada de los cursos de prueba.
 *
 * Busca en imagenes-cursos/ un PNG por curso, con el nombre corto del curso como nombre de archivo
 * (por ejemplo RD-301-PRUEBA.png), y lo deja como imagen de portada, la que Moodle muestra en el panel y en las
 * tarjetas de los cursos. Si el curso ya tenía portada, la reemplaza. Los cursos sin imagen no se tocan.
 *
 * Las imágenes son ilustraciones vectoriales propias del proyecto: los SVG de imagenes-cursos/ son la fuente y los PNG
 * son lo que se carga.
 *
 * Uso (dentro del contenedor webserver):
 *   php /opt/smart-lms/cli/cargar_imagenes_cursos.php
 *
 * @package    local_ai_assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

define('CLI_SCRIPT', true);

require('/var/www/html/config.php');
require_once($CFG->libdir . '/clilib.php');

[$options] = cli_get_params(['help' => false], ['h' => 'help']);
if ($options['help']) {
    cli_writeln('php cargar_imagenes_cursos.php');
    exit(0);
}

\core\session\manager::set_user(get_admin());

$files = glob(__DIR__ . '/imagenes-cursos/*.png');
if (!$files) {
    cli_error('No hay imágenes en ' . __DIR__ . '/imagenes-cursos/.');
}

$fs = get_file_storage();
$loaded = 0;
foreach ($files as $path) {
    $shortname = basename($path, '.png');
    $course = $DB->get_record('course', ['shortname' => $shortname]);
    if (!$course) {
        cli_writeln(' - ' . $shortname . ': el curso no existe, se omite.');
        continue;
    }
    $context = context_course::instance($course->id);
    $fs->delete_area_files($context->id, 'course', 'overviewfiles');
    $fs->create_file_from_pathname([
        'contextid' => $context->id,
        'component' => 'course',
        'filearea' => 'overviewfiles',
        'itemid' => 0,
        'filepath' => '/',
        'filename' => $shortname . '.png',
    ], $path);
    cli_writeln(' - ' . $shortname . ' (id ' . $course->id . '): portada cargada.');
    $loaded++;
}

// Las listas de cursos guardan la portada en caché.
cache_helper::purge_by_event('changesincourse');
cli_writeln('Portadas cargadas: ' . $loaded . '.');
