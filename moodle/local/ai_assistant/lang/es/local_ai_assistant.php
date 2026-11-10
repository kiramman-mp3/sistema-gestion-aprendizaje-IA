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
$string['ai_assistant:createcontent'] = 'Crear secciones y actividades de una propuesta aprobada (solo integración)';
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
$string['extraction_activityn'] = 'Actividad {$a}';
$string['extraction_acttype_assignment'] = 'Tarea';
$string['extraction_acttype_exam'] = 'Examen';
$string['extraction_acttype_forum'] = 'Foro';
$string['extraction_acttype_other'] = 'Otro';
$string['extraction_acttype_practice'] = 'Práctica';
$string['extraction_acttype_project'] = 'Proyecto';
$string['extraction_acttype_quiz'] = 'Cuestionario';
$string['extraction_acttype_resource'] = 'Recurso';
$string['extraction_add_activity'] = 'Agregar actividad';
$string['extraction_add_instrument'] = 'Agregar instrumento';
$string['extraction_add_item'] = 'Agregar elemento';
$string['extraction_add_outcome'] = 'Agregar resultado de aprendizaje';
$string['extraction_add_period'] = 'Agregar periodo de calificación';
$string['extraction_add_topic'] = 'Agregar tema';
$string['extraction_add_unit'] = 'Agregar unidad';
$string['extraction_error_date'] = 'Ingresa una fecha válida.';
$string['extraction_error_outcomeid'] = 'Usa solo letras, números, puntos, guiones y guiones bajos.';
$string['extraction_error_required'] = 'Este campo no puede estar vacío.';
$string['extraction_error_weight'] = 'Ingresa un número entre 0 y 100.';
$string['extraction_field_activitytitle'] = 'Título de la actividad';
$string['extraction_field_activitytype'] = 'Tipo de actividad';
$string['extraction_field_coursecode'] = 'Código del curso';
$string['extraction_field_coursename'] = 'Nombre del curso';
$string['extraction_field_description'] = 'Descripción';
$string['extraction_field_due'] = 'Fecha de entrega sugerida';
$string['extraction_field_enddate'] = 'Fecha de fin';
$string['extraction_field_instrument'] = 'Instrumento';
$string['extraction_field_item'] = 'Elemento';
$string['extraction_field_objective'] = 'Objetivo general';
$string['extraction_field_outcomedesc'] = 'Descripción';
$string['extraction_field_outcomeid'] = 'Identificador';
$string['extraction_field_outcomes'] = 'Resultados de aprendizaje';
$string['extraction_field_period'] = 'Periodo académico';
$string['extraction_field_periodname'] = 'Nombre del periodo';
$string['extraction_field_requiresreview'] = 'Requiere mi revisión antes de crearse';
$string['extraction_field_startdate'] = 'Fecha de inicio';
$string['extraction_field_teacher'] = 'Docente';
$string['extraction_field_topic'] = 'Tema';
$string['extraction_field_topics'] = 'Temas';
$string['extraction_field_unittitle'] = 'Título de la unidad';
$string['extraction_field_weight'] = 'Ponderación (%)';
$string['extraction_fixerrors'] = 'Corrige los valores resaltados para guardar.';
$string['extraction_generateproposal'] = 'Generar la propuesta de curso';
$string['extraction_intro'] = 'El asistente propone esta estructura a partir del sílabo. Revisa cada campo: no se crea nada en Moodle hasta que lo apruebes. Los campos marcados como dudosos faltaban o no eran claros en el documento.';
$string['extraction_issue_activity_weights_exceed_100'] = 'Las ponderaciones de las actividades de "{$a->name}" suman {$a->total}.';
$string['extraction_issue_activity_without_learning_outcome'] = 'La actividad "{$a->title}" no está vinculada a un resultado de aprendizaje.';
$string['extraction_issue_due_date_outside_unit'] = 'La fecha de "{$a->title}" está fuera del rango de la unidad.';
$string['extraction_issue_duplicate_learning_outcome_id'] = 'El resultado de aprendizaje {$a->id} está repetido.';
$string['extraction_issue_grading_period_weights_not_100'] = 'Las ponderaciones de los periodos suman {$a->total} en lugar de 100.';
$string['extraction_issue_unit_dates_reversed'] = 'La unidad "{$a->title}" termina antes de empezar.';
$string['extraction_issue_unknown_learning_outcome'] = 'El resultado de aprendizaje {$a->id} no existe en el sílabo.';
$string['extraction_issues_heading'] = 'Advertencias de coherencia';
$string['extraction_issues_note'] = 'No impiden guardar, pero revísalas antes de aprobar.';
$string['extraction_loaderror'] = 'No se pudo cargar la estructura extraída ({$a}).';
$string['extraction_loading'] = 'Cargando la estructura extraída…';
$string['extraction_markreviewed'] = 'Marcar como revisado';
$string['extraction_nooutcomes'] = 'Agrega resultados de aprendizaje arriba para vincularlos aquí.';
$string['extraction_outcomen'] = 'Resultado de aprendizaje {$a}';
$string['extraction_periodn'] = 'Periodo de calificación {$a}';
$string['extraction_reason_ambiguous'] = 'Ambiguo';
$string['extraction_reason_inconsistent'] = 'Inconsistente';
$string['extraction_reason_low_confidence'] = 'Poca confianza';
$string['extraction_reason_missing'] = 'No está en el sílabo';
$string['extraction_remove'] = 'Quitar {$a}';
$string['extraction_save'] = 'Guardar revisión';
$string['extraction_saved'] = 'Revisión guardada como versión {$a}.';
$string['extraction_saveerror'] = 'No se pudo guardar la revisión ({$a}).';
$string['extraction_saving'] = 'Guardando…';
$string['extraction_section_bibliography'] = 'Bibliografía';
$string['extraction_section_course'] = 'Curso';
$string['extraction_section_instruments'] = 'Instrumentos de evaluación';
$string['extraction_section_methodologies'] = 'Metodologías';
$string['extraction_section_outcomes'] = 'Resultados de aprendizaje';
$string['extraction_section_periods'] = 'Periodos de calificación, unidades y actividades';
$string['extraction_section_resources'] = 'Recursos';
$string['extraction_source_ai'] = 'propuesta del asistente';
$string['extraction_source_nopage'] = 'Fuente citada en el documento';
$string['extraction_source_page'] = 'Fuente: página {$a}';
$string['extraction_source_teacher'] = 'revisada por el docente';
$string['extraction_summary_clear'] = 'No queda nada por revisar.';
$string['extraction_summary_errors'] = '{$a} valores por corregir antes de guardar';
$string['extraction_summary_issues'] = '{$a} advertencias de coherencia';
$string['extraction_summary_uncertain'] = '{$a} campos dudosos por revisar';
$string['extraction_title'] = 'Revisar la estructura extraída';
$string['extraction_unitn'] = 'Unidad {$a}';
$string['extraction_unknownoutcome'] = '{$a} (no está en el sílabo)';
$string['extraction_untitled'] = '(sin título)';
$string['extraction_version'] = 'Versión {$a->version}, {$a->source}';
$string['jwtsecret'] = 'Secreto de firma JWT';
$string['jwtsecret_desc'] = 'Secreto compartido para firmar los tokens de vida corta que recibe el backend. Debe coincidir con PLUGIN_JWT_SECRET del backend y tener al menos 32 caracteres.';
$string['jwtsecretmissing'] = 'El secreto de firma JWT no está configurado o tiene menos de 32 caracteres.';
$string['pluginname'] = 'Asistente docente con IA';
$string['privacy:metadata:backend'] = 'El backend de Smart LMS procesa información del curso para planificarlo, responder preguntas y sugerir estrategias pedagógicas.';
$string['privacy:metadata:backend:courseid'] = 'El ID del curso en el que se usa el asistente.';
$string['privacy:metadata:backend:message'] = 'Preguntas que el docente escribe en el chat del asistente.';
$string['privacy:metadata:backend:syllabus'] = 'Archivos de sílabo que carga el docente.';
$string['privacy:metadata:backend:userid'] = 'El ID del usuario que usa el asistente.';
$string['proposal_activityn'] = 'Actividad {$a}';
$string['proposal_add_activity'] = 'Agregar actividad';
$string['proposal_add_section'] = 'Agregar sección';
$string['proposal_approve'] = 'Aprobar la propuesta';
$string['proposal_approvedinfo'] = 'Aprobada por el usuario {$a->user} el {$a->date}. Si la editas, vuelve a revisión.';
$string['proposal_approveerror'] = 'No se pudo aprobar la propuesta ({$a}).';
$string['proposal_approvehint'] = 'Guarda los cambios y corrige los errores para aprobar.';
$string['proposal_approving'] = 'Aprobando…';
$string['proposal_basedon'] = 'Basada en la versión {$a} de la estructura extraída.';
$string['proposal_createanother'] = 'Crear otra propuesta';
$string['proposal_createerror'] = 'No se pudo generar la propuesta ({$a}).';
$string['proposal_error_date'] = 'Ingresa una fecha válida.';
$string['proposal_error_toolong'] = 'El título es demasiado largo (255 caracteres como máximo).';
$string['proposal_error_weight'] = 'Ingresa un número entre 0 y 100.';
$string['proposal_exists'] = 'Este sílabo ya tiene una propuesta. Puedes abrirla o crear otra.';
$string['proposal_field_description'] = 'Descripción';
$string['proposal_field_due'] = 'Fecha de entrega';
$string['proposal_field_outcomes'] = 'Resultados de aprendizaje';
$string['proposal_field_title'] = 'Título';
$string['proposal_field_type'] = 'Elemento de Moodle';
$string['proposal_field_weight'] = 'Ponderación (%)';
$string['proposal_generate'] = 'Generar la propuesta de curso';
$string['proposal_generating'] = 'Generando la propuesta…';
$string['proposal_intro'] = 'Esta es la estructura que el asistente crearía en Moodle: una sección por unidad, con sus actividades. Revísala y edítala. No se crea nada en Moodle hasta que la apruebes y confirmes la publicación.';
$string['proposal_issues_heading'] = 'Observaciones generales';
$string['proposal_itemtype_assign'] = 'Tarea';
$string['proposal_itemtype_forum'] = 'Foro';
$string['proposal_itemtype_label'] = 'Etiqueta';
$string['proposal_itemtype_page'] = 'Página';
$string['proposal_itemtype_quiz'] = 'Cuestionario (vacío)';
$string['proposal_loaderror'] = 'No se pudo cargar la propuesta ({$a}).';
$string['proposal_loading'] = 'Cargando la propuesta…';
$string['proposal_movedown'] = 'Bajar {$a}';
$string['proposal_moveup'] = 'Subir {$a}';
$string['proposal_nooutcomes'] = 'No hay resultados de aprendizaje disponibles.';
$string['proposal_notreviewed'] = 'Guarda tu revisión de la estructura extraída antes de generar la propuesta.';
$string['proposal_openexisting'] = 'Abrir la propuesta existente';
$string['proposal_readonly'] = 'Esta propuesta ya no se puede editar.';
$string['proposal_remove'] = 'Quitar {$a}';
$string['proposal_save'] = 'Guardar cambios';
$string['proposal_saved'] = 'Cambios guardados.';
$string['proposal_saveerror'] = 'No se pudieron guardar los cambios ({$a}).';
$string['proposal_saving'] = 'Guardando…';
$string['proposal_sectionn'] = 'Sección {$a}';
$string['proposal_severity_error'] = 'Error';
$string['proposal_severity_warning'] = 'Advertencia';
$string['proposal_status_approved'] = 'Aprobada';
$string['proposal_status_draft'] = 'Borrador';
$string['proposal_status_failed'] = 'Fallida';
$string['proposal_status_needs_review'] = 'Pendiente de revisión';
$string['proposal_status_published'] = 'Publicada';
$string['proposal_status_publishing'] = 'Publicando';
$string['proposal_status_rejected'] = 'Rechazada';
$string['proposal_summary_clear'] = 'Sin observaciones pendientes.';
$string['proposal_summary_errors'] = '{$a} errores por corregir antes de aprobar';
$string['proposal_summary_unsaved'] = 'Cambios sin guardar. Guarda para actualizar la revisión.';
$string['proposal_summary_warnings'] = '{$a} advertencias por revisar';
$string['proposal_title'] = 'Propuesta de curso';
$string['proposal_untitled'] = '(sin título)';
$string['syllabus'] = 'Sílabo del curso';
$string['syllabusdesc'] = 'Sube el sílabo en PDF o DOCX (hasta 10 MB). El asistente extrae su texto para que luego revises la estructura del curso.';
$string['syllabusduplicate'] = 'Este archivo ya se cargó en el curso. Se muestra su estado.';
$string['syllabusextract'] = 'Extraer la estructura del curso';
$string['syllabusextractfailed'] = 'No se pudo extraer la estructura del curso ({$a}).';
$string['syllabusextracting'] = 'Extrayendo la estructura del curso…';
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
