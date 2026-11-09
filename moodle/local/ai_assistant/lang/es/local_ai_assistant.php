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
 * Spanish strings for local_ai_assistant.
 *
 * @package    local_ai_assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$string['ai_assistant:checkaccess'] = 'Consultar qué pueden hacer otros usuarios con el asistente (solo integración)';
$string['ai_assistant:publish'] = 'Publicar estructuras de curso generadas con IA';
$string['ai_assistant:use'] = 'Usar el asistente docente con IA';
$string['ai_assistant:viewanalytics'] = 'Ver la analítica y las evidencias de estudiantes del asistente';
$string['ainotice'] = 'Este asistente usa inteligencia artificial. Sus sugerencias requieren tu revisión antes de aplicarlas.';
$string['assistant'] = 'Asistente IA';
$string['backendnotconfigured'] = 'La URL del backend no está configurada. Pide al administrador del sitio que complete los ajustes del plugin.';
$string['backendurl'] = 'URL del backend';
$string['backendurl_desc'] = 'URL base de la API del backend de Smart LMS, incluido el prefijo /api/v1. La usa el navegador, así que debe ser accesible desde los equipos de los usuarios y estar permitida en CORS_ORIGINS del backend.';
$string['cappublish'] = 'Publicar estructuras de curso';
$string['capuse'] = 'Usar el asistente';
$string['capviewanalytics'] = 'Ver analítica';
$string['connected'] = 'Conectado con el backend. Tus permisos en este curso:';
$string['connecting'] = 'Conectando con el backend…';
$string['connection'] = 'Conexión con el backend';
$string['connectionerror'] = 'No se pudo conectar con el backend ({$a}).';
$string['jwtsecret'] = 'Secreto de firma JWT';
$string['jwtsecret_desc'] = 'Secreto compartido para firmar los tokens de vida corta que recibe el backend. Debe coincidir con PLUGIN_JWT_SECRET del backend y tener al menos 32 caracteres.';
$string['jwtsecretmissing'] = 'El secreto de firma JWT no está configurado o tiene menos de 32 caracteres.';
$string['pluginname'] = 'Asistente docente con IA';
$string['privacy:metadata:backend'] = 'El backend de Smart LMS procesa información del curso para planificarlo, responder preguntas y sugerir estrategias pedagógicas.';
$string['privacy:metadata:backend:courseid'] = 'El ID del curso en el que se usa el asistente.';
$string['privacy:metadata:backend:message'] = 'Preguntas que el docente escribe en el chat del asistente.';
$string['privacy:metadata:backend:syllabus'] = 'Archivos de sílabo que carga el docente.';
$string['privacy:metadata:backend:userid'] = 'El ID del usuario que usa el asistente.';
$string['syllabus'] = 'Sílabo del curso';
$string['syllabusdesc'] = 'Sube el sílabo en PDF o DOCX (hasta 10 MB). El asistente extrae su texto para que luego revises la estructura del curso.';
$string['syllabusduplicate'] = 'Este archivo ya se cargó en el curso. Se muestra su estado.';
$string['syllabusfailed'] = 'No se pudo extraer el texto ({$a}).';
$string['syllabusfailed_corrupt'] = 'El archivo está dañado o no es un documento válido.';
$string['syllabusfailed_empty'] = 'No se encontró texto en el documento, ni siquiera con OCR.';
$string['syllabusfailed_encrypted'] = 'El PDF está protegido con contraseña. Quita la protección y vuelve a subirlo.';
$string['syllabusfile'] = 'Archivo del sílabo';
$string['syllabuslowconfidence'] = 'Parte del texto se reconoció con OCR en páginas escaneadas. Revísalo con cuidado.';
$string['syllabusprocessing'] = 'Extrayendo el texto…';
$string['syllabusready'] = 'Texto extraído. Páginas: {$a}.';
$string['syllabusreadynopages'] = 'Texto extraído.';
$string['syllabusrejected'] = 'El archivo fue rechazado: {$a}';
$string['syllabustimeout'] = 'El procesamiento está tardando más de lo previsto. Recarga la página en unos minutos.';
$string['syllabustoolarge'] = 'El archivo supera los 10 MB.';
$string['syllabustype'] = 'Solo se aceptan archivos PDF o DOCX.';
$string['syllabusupload'] = 'Subir sílabo';
$string['syllabusuploading'] = 'Subiendo y analizando el archivo…';
