import { z } from "zod";

/** `PUT /courses/:courseId/activity-mappings/:cmId` */
export const saveMappingSchema = z.object({
  /** Ruta de la unidad en la extracción, por ejemplo `gradingPeriods[0].units[1]`. */
  unitRef: z.string().min(1).max(200),
  learningOutcomeIds: z
    .array(z.string().regex(/^[A-Za-z0-9._-]+$/))
    .max(20)
    .default([]),
});

export type SaveMappingInput = z.infer<typeof saveMappingSchema>;

export interface UnitDto {
  unitRef: string;
  title: string;
  periodName: string;
  learningOutcomeIds: string[];
}

export interface OutcomeDto {
  id: string;
  description: string;
}

export interface MappingDto {
  moodleCmId: number;
  unitRef: string;
  learningOutcomeIds: string[];
  /** `PROPOSAL` si se creó al publicar una propuesta; `MANUAL` si lo eligió el docente. */
  source: "PROPOSAL" | "MANUAL";
}

/** `components/schemas/ActivityMappings` del contrato OpenAPI. */
export interface MappingOverviewDto {
  /** Sílabo revisado del que salen las unidades; `null` si el curso no tiene ninguno. */
  syllabusId: string | null;
  extractionVersion: number | null;
  units: UnitDto[];
  outcomes: OutcomeDto[];
  mappings: MappingDto[];
}
