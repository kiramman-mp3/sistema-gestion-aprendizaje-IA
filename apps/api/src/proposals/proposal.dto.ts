import { z } from "zod";
import type { CourseProposal, ProposalItem } from "../generated/prisma/client";
import { ProposalItemType } from "../generated/prisma/enums";
import type { ProposalIssue } from "./proposal-validation";

/** Máximo de elementos por propuesta; un curso real tiene decenas. */
export const MAX_PROPOSAL_ITEMS = 500;

/** `POST /proposals` */
export const createProposalSchema = z.object({
  syllabusId: z.uuid(),
  extractionVersion: z.number().int().min(1),
  /** Confirma que se quiere otra propuesta aunque el mismo sílabo ya tenga una (RF-07). */
  confirmDuplicate: z.boolean().optional(),
});

/**
 * Un elemento enviado por el docente. `moodleItemId` y `publishStatus` son de solo lectura: si el
 * cliente los devuelve, se ignoran. Un elemento nuevo trae un UUID que el cliente genera.
 */
export const proposalItemInputSchema = z.object({
  id: z.uuid().optional(),
  parentId: z.uuid().nullable().optional(),
  itemType: z.enum(Object.values(ProposalItemType) as [ProposalItemType, ...ProposalItemType[]]),
  // Un título vacío se permite al guardar (el docente está a medias) y se marca al aprobar.
  title: z.string().trim().max(255),
  description: z.string().max(5000).nullable().optional(),
  unitRef: z.string().min(1).max(200).optional(),
  learningOutcomeIds: z
    .array(z.string().regex(/^[A-Za-z0-9._-]+$/))
    .max(20)
    .optional(),
  dueDate: z.iso.date().nullable().optional(),
  weight: z.number().min(0).max(100).nullable().optional(),
});

/** `PATCH /proposals/:id` */
export const updateProposalSchema = z.object({
  items: z.array(proposalItemInputSchema).max(MAX_PROPOSAL_ITEMS),
});

export type CreateProposalInput = z.infer<typeof createProposalSchema>;
export type ProposalItemInput = z.infer<typeof proposalItemInputSchema>;

/** `components/schemas/ProposalItem` del contrato OpenAPI. */
export interface ProposalItemDto {
  id: string;
  parentId: string | null;
  itemType: ProposalItem["itemType"];
  title: string;
  description: string | null;
  position: number;
  unitRef: string;
  learningOutcomeIds: string[];
  dueDate: string | null;
  weight: number | null;
  moodleItemId: number | null;
  publishStatus: ProposalItem["publishStatus"];
}

/** `components/schemas/Proposal` del contrato OpenAPI. */
export interface ProposalDto {
  id: string;
  courseId: number;
  syllabusId: string;
  extractionVersion: number;
  status: CourseProposal["status"];
  approvedBy: number | null;
  approvedAt: string | null;
  items: ProposalItemDto[];
  /** Errores y advertencias de la revisión; los errores impiden aprobar. */
  issues: ProposalIssue[];
}

export type ProposalWithItems = CourseProposal & {
  items: ProposalItem[];
  extraction: { version: number; documentId: string };
};

export function toProposalItemDto(item: ProposalItem): ProposalItemDto {
  return {
    id: item.id,
    parentId: item.parentId,
    itemType: item.itemType,
    title: item.title,
    description: item.description,
    position: item.position,
    unitRef: item.unitRef,
    learningOutcomeIds: item.learningOutcomeIds,
    dueDate: item.dueDate ? item.dueDate.toISOString().slice(0, 10) : null,
    // Prisma devuelve un Decimal; el contrato usa número.
    weight: item.weight === null ? null : Number(item.weight),
    moodleItemId: item.moodleItemId,
    publishStatus: item.publishStatus,
  };
}

export function toProposalDto(proposal: ProposalWithItems, issues: ProposalIssue[]): ProposalDto {
  return {
    id: proposal.id,
    courseId: proposal.moodleCourseId,
    syllabusId: proposal.extraction.documentId,
    extractionVersion: proposal.extraction.version,
    status: proposal.status,
    approvedBy: proposal.approvedBy,
    approvedAt: proposal.approvedAt ? proposal.approvedAt.toISOString() : null,
    items: [...proposal.items].sort((a, b) => a.position - b.position).map(toProposalItemDto),
    issues,
  };
}
