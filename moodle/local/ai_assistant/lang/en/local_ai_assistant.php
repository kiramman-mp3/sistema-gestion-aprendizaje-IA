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
 * English strings for local_ai_assistant.
 *
 * @package    local_ai_assistant
 * @copyright  2026 Smart LMS project
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$string['ai_assistant:checkaccess'] = 'Check what other users may do with the AI assistant (integration only)';
$string['ai_assistant:publish'] = 'Publish AI-generated course structures';
$string['ai_assistant:use'] = 'Use the AI teaching assistant';
$string['ai_assistant:viewanalytics'] = 'View AI assistant analytics and student evidence';
$string['ainotice'] = 'This assistant uses artificial intelligence. Its suggestions require your review before you act on them.';
$string['assistant'] = 'AI assistant';
$string['backendnotconfigured'] = 'The backend URL is not configured. Ask the site administrator to complete the plugin settings.';
$string['backendurl'] = 'Backend URL';
$string['backendurl_desc'] = 'Base URL of the Smart LMS backend API, including the /api/v1 prefix. The browser calls this URL, so it must be reachable from the computers of the users and allowed in CORS_ORIGINS of the backend.';
$string['cappublish'] = 'Publish course structures';
$string['capuse'] = 'Use the assistant';
$string['capviewanalytics'] = 'View analytics';
$string['connected'] = 'Connected to the backend. Your permissions in this course:';
$string['connecting'] = 'Connecting to the backend…';
$string['connection'] = 'Backend connection';
$string['connectionerror'] = 'Could not connect to the backend ({$a}).';
$string['extraction_activityn'] = 'Activity {$a}';
$string['extraction_acttype_assignment'] = 'Assignment';
$string['extraction_acttype_exam'] = 'Exam';
$string['extraction_acttype_forum'] = 'Forum';
$string['extraction_acttype_other'] = 'Other';
$string['extraction_acttype_practice'] = 'Practice';
$string['extraction_acttype_project'] = 'Project';
$string['extraction_acttype_quiz'] = 'Quiz';
$string['extraction_acttype_resource'] = 'Resource';
$string['extraction_add_activity'] = 'Add activity';
$string['extraction_add_instrument'] = 'Add instrument';
$string['extraction_add_item'] = 'Add item';
$string['extraction_add_outcome'] = 'Add learning outcome';
$string['extraction_add_period'] = 'Add grading period';
$string['extraction_add_topic'] = 'Add topic';
$string['extraction_add_unit'] = 'Add unit';
$string['extraction_error_date'] = 'Enter a valid date.';
$string['extraction_error_outcomeid'] = 'Use only letters, numbers, dots, hyphens and underscores.';
$string['extraction_error_required'] = 'This field cannot be empty.';
$string['extraction_error_weight'] = 'Enter a number between 0 and 100.';
$string['extraction_field_activitytitle'] = 'Activity title';
$string['extraction_field_activitytype'] = 'Activity type';
$string['extraction_field_coursecode'] = 'Course code';
$string['extraction_field_coursename'] = 'Course name';
$string['extraction_field_description'] = 'Description';
$string['extraction_field_due'] = 'Suggested due date';
$string['extraction_field_enddate'] = 'End date';
$string['extraction_field_instrument'] = 'Instrument';
$string['extraction_field_item'] = 'Item';
$string['extraction_field_objective'] = 'General objective';
$string['extraction_field_outcomedesc'] = 'Description';
$string['extraction_field_outcomeid'] = 'Identifier';
$string['extraction_field_outcomes'] = 'Learning outcomes';
$string['extraction_field_period'] = 'Academic period';
$string['extraction_field_periodname'] = 'Period name';
$string['extraction_field_requiresreview'] = 'Needs my review before it is created';
$string['extraction_field_startdate'] = 'Start date';
$string['extraction_field_teacher'] = 'Teacher';
$string['extraction_field_topic'] = 'Topic';
$string['extraction_field_topics'] = 'Topics';
$string['extraction_field_unittitle'] = 'Unit title';
$string['extraction_field_weight'] = 'Weight (%)';
$string['extraction_fixerrors'] = 'Fix the highlighted values to save.';
$string['extraction_intro'] = 'The assistant proposes this structure from the syllabus. Check every field: nothing is created in Moodle until you approve it. Fields marked as uncertain were missing or unclear in the document.';
$string['extraction_issue_activity_weights_exceed_100'] = 'The weights of the activities of "{$a->name}" add up to {$a->total}.';
$string['extraction_issue_activity_without_learning_outcome'] = 'The activity "{$a->title}" is not linked to a learning outcome.';
$string['extraction_issue_due_date_outside_unit'] = 'The date of "{$a->title}" is outside the unit\'s date range.';
$string['extraction_issue_duplicate_learning_outcome_id'] = 'The learning outcome {$a->id} is repeated.';
$string['extraction_issue_grading_period_weights_not_100'] = 'The weights of the grading periods add up to {$a->total} instead of 100.';
$string['extraction_issue_unit_dates_reversed'] = 'The unit "{$a->title}" ends before it starts.';
$string['extraction_issue_unknown_learning_outcome'] = 'The learning outcome {$a->id} does not exist in the syllabus.';
$string['extraction_issues_heading'] = 'Consistency warnings';
$string['extraction_issues_note'] = 'They do not prevent saving, but check them before approving.';
$string['extraction_loaderror'] = 'The extracted structure could not be loaded ({$a}).';
$string['extraction_loading'] = 'Loading the extracted structure…';
$string['extraction_markreviewed'] = 'Mark as reviewed';
$string['extraction_nooutcomes'] = 'Add learning outcomes above to link them here.';
$string['extraction_outcomen'] = 'Learning outcome {$a}';
$string['extraction_periodn'] = 'Grading period {$a}';
$string['extraction_reason_ambiguous'] = 'Ambiguous';
$string['extraction_reason_inconsistent'] = 'Inconsistent';
$string['extraction_reason_low_confidence'] = 'Low confidence';
$string['extraction_reason_missing'] = 'Not in the syllabus';
$string['extraction_remove'] = 'Remove {$a}';
$string['extraction_save'] = 'Save review';
$string['extraction_saved'] = 'Review saved as version {$a}.';
$string['extraction_saveerror'] = 'The review could not be saved ({$a}).';
$string['extraction_saving'] = 'Saving…';
$string['extraction_section_bibliography'] = 'Bibliography';
$string['extraction_section_course'] = 'Course';
$string['extraction_section_instruments'] = 'Assessment instruments';
$string['extraction_section_methodologies'] = 'Methodologies';
$string['extraction_section_outcomes'] = 'Learning outcomes';
$string['extraction_section_periods'] = 'Grading periods, units and activities';
$string['extraction_section_resources'] = 'Resources';
$string['extraction_source_ai'] = 'proposed by the assistant';
$string['extraction_source_nopage'] = 'Source cited in the document';
$string['extraction_source_page'] = 'Source: page {$a}';
$string['extraction_source_teacher'] = 'reviewed by the teacher';
$string['extraction_summary_clear'] = 'Nothing left to review.';
$string['extraction_summary_errors'] = '{$a} values to fix before saving';
$string['extraction_summary_issues'] = '{$a} consistency warnings';
$string['extraction_summary_uncertain'] = '{$a} uncertain fields to review';
$string['extraction_title'] = 'Review the extracted structure';
$string['extraction_unitn'] = 'Unit {$a}';
$string['extraction_unknownoutcome'] = '{$a} (not in the syllabus)';
$string['extraction_untitled'] = '(untitled)';
$string['extraction_version'] = 'Version {$a->version}, {$a->source}';
$string['jwtsecret'] = 'JWT signing secret';
$string['jwtsecret_desc'] = 'Shared secret used to sign short-lived tokens for the backend. It must match PLUGIN_JWT_SECRET in the backend and be at least 32 characters long.';
$string['jwtsecretmissing'] = 'The JWT signing secret is not configured or is shorter than 32 characters.';
$string['pluginname'] = 'AI teaching assistant';
$string['privacy:metadata:backend'] = 'The Smart LMS backend processes course information to plan courses, answer questions and suggest teaching strategies.';
$string['privacy:metadata:backend:courseid'] = 'The ID of the course in which the assistant is used.';
$string['privacy:metadata:backend:message'] = 'Questions written by the teacher in the assistant chat.';
$string['privacy:metadata:backend:syllabus'] = 'Syllabus files uploaded by the teacher.';
$string['privacy:metadata:backend:userid'] = 'The ID of the user who uses the assistant.';
$string['syllabus'] = 'Course syllabus';
$string['syllabusdesc'] = 'Upload the syllabus as PDF or DOCX (up to 10 MB). The assistant extracts its text so you can review the course structure later.';
$string['syllabusduplicate'] = 'This file was already uploaded to the course. Showing its status.';
$string['syllabusextract'] = 'Extract the course structure';
$string['syllabusextractfailed'] = 'The course structure could not be extracted ({$a}).';
$string['syllabusextracting'] = 'Extracting the course structure…';
$string['syllabusfailed'] = 'The text could not be extracted ({$a}).';
$string['syllabusfailed_corrupt'] = 'The file is damaged or is not a valid document.';
$string['syllabusfailed_empty'] = 'No text was found in the document, not even with OCR.';
$string['syllabusfailed_encrypted'] = 'The PDF is password protected. Remove the protection and upload it again.';
$string['syllabusfile'] = 'Syllabus file';
$string['syllabuslowconfidence'] = 'Part of the text was recognized with OCR from scanned pages. Review it carefully.';
$string['syllabusprocessing'] = 'Extracting text…';
$string['syllabusready'] = 'Text extracted. Pages: {$a}.';
$string['syllabusreadynopages'] = 'Text extracted.';
$string['syllabusrejected'] = 'The file was rejected: {$a}';
$string['syllabustimeout'] = 'Processing is taking longer than expected. Reload the page in a few minutes.';
$string['syllabustoolarge'] = 'The file is larger than 10 MB.';
$string['syllabustype'] = 'Only PDF or DOCX files are accepted.';
$string['syllabusupload'] = 'Upload syllabus';
$string['syllabusuploading'] = 'Uploading and scanning the file…';
