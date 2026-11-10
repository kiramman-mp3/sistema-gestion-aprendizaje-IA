import { z } from "zod";
import type { PublishOperation } from "../generated/prisma/client";

/** `POST /proposals/:id/publish`: sin `confirm: true` explícito no se publica (RF-09). */
export const publishBodySchema = z.object({ confirm: z.literal(true) });

/** Cabecera `Idempotency-Key`: la genera el cliente por cada intento de publicar. */
export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

/** `components/schemas/PublishOperation` del contrato OpenAPI. */
export interface PublishOperationDto {
  id: string;
  proposalId: string;
  status: PublishOperation["status"];
  /** Elementos de la propuesta. */
  totalCount: number;
  createdCount: number;
  failedCount: number;
  failures: { itemId: string; error: string }[];
  createdAt: string;
  finishedAt: string | null;
}

export function toPublishOperationDto(
  operation: PublishOperation,
  totalCount: number,
  failures: { itemId: string; error: string }[],
): PublishOperationDto {
  return {
    id: operation.id,
    proposalId: operation.proposalId,
    status: operation.status,
    totalCount,
    createdCount: operation.createdCount,
    failedCount: operation.failedCount,
    failures,
    createdAt: operation.createdAt.toISOString(),
    finishedAt: operation.finishedAt ? operation.finishedAt.toISOString() : null,
  };
}
