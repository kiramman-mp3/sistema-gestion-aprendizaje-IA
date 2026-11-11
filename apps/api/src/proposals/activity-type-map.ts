import type { ActivityType } from "@smart-lms/contracts";
import type { ProposalItemType } from "../generated/prisma/enums";

/**
 * Tipo de actividad de la extracción → elemento de Moodle (D-05, propuesta provisional).
 *
 * - `assignment`, `practice` y `project` se entregan: tarea.
 * - `quiz` y `exam` se rinden en línea: cuestionario (se crea vacío; el docente carga las preguntas).
 * - `forum` es un foro.
 * - `resource` es material de lectura: página.
 * - `other` no tiene equivalente seguro: etiqueta, que el docente puede reemplazar al revisar.
 */
export const ACTIVITY_TYPE_TO_ITEM_TYPE: Record<
  ActivityType,
  Exclude<ProposalItemType, "SECTION">
> = {
  assignment: "ASSIGN",
  practice: "ASSIGN",
  project: "ASSIGN",
  quiz: "QUIZ",
  exam: "QUIZ",
  forum: "FORUM",
  resource: "PAGE",
  other: "LABEL",
};
