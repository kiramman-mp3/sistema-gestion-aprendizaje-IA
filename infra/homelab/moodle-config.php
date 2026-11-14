<?php
// Configuración de Moodle para el despliegue de demostración en un homelab (docker-compose.homelab.yml).
// Todo sale del entorno del contenedor: aquí no hay secretos.
//
// TLS lo termina un proxy delante (tailscale serve u otro): Moodle recibe HTTP pero su dirección pública es HTTPS
// (sslproxy) y el proxy puede cambiar la cabecera Host (reverseproxy), así que no se compara con wwwroot.

unset($CFG);
global $CFG;
$CFG = new stdClass();

$CFG->dbtype    = 'pgsql';
$CFG->dblibrary = 'native';
$CFG->dbhost    = getenv('MOODLE_DB_HOST') ?: 'moodle-db';
$CFG->dbname    = getenv('MOODLE_DB_NAME') ?: 'moodle';
$CFG->dbuser    = getenv('MOODLE_DB_USER') ?: 'moodle';
$CFG->dbpass    = trim((string) @file_get_contents('/run/secrets/moodle_db_password'));
$CFG->prefix    = 'mdl_';
$CFG->dboptions = ['dbpersist' => false, 'dbsocket' => false, 'dbport' => ''];

$CFG->wwwroot      = getenv('MOODLE_WWWROOT');
$CFG->dataroot     = '/var/www/moodledata';
$CFG->admin        = 'admin';
$CFG->directorypermissions = 02770;

$CFG->sslproxy     = true;
$CFG->reverseproxy = true;

// Sin correo saliente en la demostración.
$CFG->noemailever = true;

require_once(__DIR__ . '/lib/setup.php');
