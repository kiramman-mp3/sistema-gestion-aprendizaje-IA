import type { SyllabusExtraction } from "@smart-lms/contracts";
import type { ProposalItemType } from "../generated/prisma/enums";
import { ACTIVITY_TYPE_TO_ITEM_TYPE } from "./activity-type-map";

/** Elemento propuesto, todavía sin identificador de base de datos. */
export interface DraftItem {
  /** Identifica el elemento dentro del borrador; las actividades lo usan para señalar su sección. */
  key: string;
  parentKey: string | null;
  itemType: ProposalItemType;
  title: string;
  description: string | null;
  /** Orden global del elemento, depth-first: una sección y luego sus actividades. */
  position: number;
  /** Ruta de la unidad en la extracción, por ejemplo `gradingPeriods[0].units[1]`. */
  unitRef: string;
  learningOutcomeIds: string[];
  /** `AAAA-MM-DD`; solo existe si la extracción la trae. */
  dueDate: string | null;
  weight: number | null;
}

/**
 * Convierte una extracción en la estructura propuesta para el curso (RF-07).
 *
 * - Cada unidad es una sección; sus temas van en la descripción.
 * - Cada actividad es un elemento hijo de su sección, con el tipo de Moodle según D-05.
 * - Una actividad sin resultados de aprendizaje propios hereda los de su unidad.
 * - No inventa nada: la fecha y la ponderación son las de la extracción, o `null`.
 *
 * Es una función pura: la misma extracción produce siempre la misma propuesta.
 */
export function generateProposalItems(extraction: SyllabusExtraction): DraftItem[] {
  const items: DraftItem[] = [];

  extraction.gradingPeriods.forEach((period, p) => {
    period.units.forEach((unit, u) => {
      const unitRef = `gradingPeriods[${p}].units[${u}]`;
      items.push({
        key: unitRef,
        parentKey: null,
        itemType: "SECTION",
        title: unit.title,
        description:
          unit.topics.length > 0 ? unit.topics.map((topic) => `• ${topic}`).join("\n") : null,
        position: items.length,
        unitRef,
        learningOutcomeIds: [...unit.learningOutcomeIds],
        dueDate: null,
        weight: null,
      });

      unit.activities.forEach((activity, a) => {
        items.push({
          key: `${unitRef}.activities[${a}]`,
          parentKey: unitRef,
          itemType: ACTIVITY_TYPE_TO_ITEM_TYPE[activity.type],
          title: activity.title,
          description: activity.description,
          position: items.length,
          unitRef,
          learningOutcomeIds:
            activity.learningOutcomeIds.length > 0
              ? [...activity.learningOutcomeIds]
              : [...unit.learningOutcomeIds],
          dueDate: activity.suggestedDueDate,
          weight: activity.weight,
        });
      });
    });
  });

  return items;
}
