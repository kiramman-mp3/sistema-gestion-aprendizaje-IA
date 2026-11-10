import { ConflictException } from "@nestjs/common";
import { ProposalStatus } from "../generated/prisma/enums";

/**
 * Transiciones permitidas de una propuesta (RF-08). Reproduce el diagrama de
 * `docs/architecture/modelo-datos.md`; lo que no aparece aquí se rechaza.
 *
 * - `DRAFT` → `NEEDS_REVIEW`: la propuesta generada queda lista para revisión.
 * - `NEEDS_REVIEW` → `APPROVED`, `REJECTED` o `DRAFT`.
 * - `APPROVED` → `PUBLISHING` (con confirmación) o de vuelta a `NEEDS_REVIEW` si el docente edita.
 * - `PUBLISHING` → `PUBLISHED` o `FAILED`; `FAILED` → `PUBLISHING` para reanudar.
 */
export const PROPOSAL_TRANSITIONS: Readonly<Record<ProposalStatus, readonly ProposalStatus[]>> = {
  DRAFT: ["NEEDS_REVIEW"],
  NEEDS_REVIEW: ["DRAFT", "APPROVED", "REJECTED"],
  APPROVED: ["NEEDS_REVIEW", "PUBLISHING"],
  PUBLISHING: ["PUBLISHED", "FAILED"],
  PUBLISHED: [],
  REJECTED: [],
  FAILED: ["PUBLISHING"],
};

/** Estados en los que el docente puede editar los elementos. */
export const EDITABLE_STATUSES: readonly ProposalStatus[] = ["DRAFT", "NEEDS_REVIEW", "APPROVED"];

export function canTransition(from: ProposalStatus, to: ProposalStatus): boolean {
  return PROPOSAL_TRANSITIONS[from].includes(to);
}

/** Transición que el diagrama no permite; responde 409 (RF-08). */
export class InvalidTransitionError extends ConflictException {
  constructor(
    readonly from: ProposalStatus,
    readonly to: ProposalStatus,
  ) {
    super({
      code: "INVALID_TRANSITION",
      message: `Una propuesta en estado ${from} no puede pasar a ${to}.`,
    });
  }
}

export function assertTransition(from: ProposalStatus, to: ProposalStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/**
 * Estado resultante de editar los elementos. Una propuesta aprobada vuelve a revisión, porque lo que
 * aprobó el docente ya no es lo que se publicaría; una en borrador o en revisión conserva su estado.
 *
 * @throws InvalidTransitionError si el estado no admite ediciones (por ejemplo, ya se está publicando).
 */
export function statusAfterEdit(status: ProposalStatus): ProposalStatus {
  if (!EDITABLE_STATUSES.includes(status)) {
    throw new ConflictException({
      code: "PROPOSAL_NOT_EDITABLE",
      message: `Una propuesta en estado ${status} ya no se puede editar.`,
    });
  }
  if (status === "APPROVED") {
    assertTransition("APPROVED", "NEEDS_REVIEW");
    return "NEEDS_REVIEW";
  }
  return status;
}
