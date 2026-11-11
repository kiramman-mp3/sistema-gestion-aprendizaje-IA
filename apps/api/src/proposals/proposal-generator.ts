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

export interface GenerateOptions {
  /** Ver `ProposalPolicy.deriveActivitiesFromInstruments`. Por defecto, sí. */
  deriveActivitiesFromInstruments?: boolean;
}

/** Los componentes que se rinden con exámenes o pruebas se proponen como cuestionario; el resto, como tarea. */
const QUIZ_COMPONENT = /contacto|sumativ|ex[aá]men|prueba|lecci[oó]n/i;

/** «APRENDIZAJE PRÁCTICO EXPERIMENTAL» → «Aprendizaje práctico experimental». */
function sentenceCase(text: string): string {
  const lower = text.trim().toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Convierte una extracción en la estructura propuesta para el curso (RF-07).
 *
 * - Cada unidad es una sección; sus temas van en la descripción.
 * - Cada actividad es un elemento hijo de su sección, con el tipo de Moodle según D-05.
 * - Una actividad sin resultados de aprendizaje propios hereda los de su unidad.
 * - No inventa nada: la fecha y la ponderación son las de la extracción, o `null`.
 * - Excepción marcada: si ninguna unidad trae actividades pero el sílabo sí define componentes de evaluación, se propone
 *   una actividad **sugerida** por componente en cada unidad. Su descripción empieza con «Sugerida», lleva el porcentaje
 *   del componente y no tiene fecha ni ponderación propias: el docente las revisa.
 *
 * Es una función pura: la misma extracción produce siempre la misma propuesta.
 */
export function generateProposalItems(
  extraction: SyllabusExtraction,
  { deriveActivitiesFromInstruments = true }: GenerateOptions = {},
): DraftItem[] {
  const items: DraftItem[] = [];
  const noUnitHasActivities = extraction.gradingPeriods.every((period) =>
    period.units.every((unit) => unit.activities.length === 0),
  );
  // Un mismo componente no se repite si el documento lo lista dos veces.
  const seen = new Set<string>();
  const instruments =
    deriveActivitiesFromInstruments && noUnitHasActivities
      ? extraction.assessmentInstruments.filter((instrument) => {
          const key = instrument.name.trim().toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
      : [];

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

      instruments.forEach((instrument, i) => {
        const percentage = instrument.weight === null ? "" : ` (${instrument.weight} % de la nota)`;
        items.push({
          key: `${unitRef}.suggested[${i}]`,
          parentKey: unitRef,
          itemType: QUIZ_COMPONENT.test(instrument.name) ? "QUIZ" : "ASSIGN",
          title: `${sentenceCase(instrument.name)} — ${unit.title}`.slice(0, 255),
          description:
            `Sugerida a partir del componente de evaluación «${instrument.name.trim()}»${percentage} del sílabo. ` +
            "El sílabo no define actividades por unidad: revisa el título, el tipo, la fecha y la ponderación.",
          position: items.length,
          unitRef,
          learningOutcomeIds: [...unit.learningOutcomeIds],
          dueDate: null,
          weight: null,
        });
      });
    });
  });

  return items;
}
