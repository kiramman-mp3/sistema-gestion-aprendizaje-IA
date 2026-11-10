import { ProposalItemType } from "../generated/prisma/enums";

/**
 * Reglas institucionales que condicionan una propuesta. Los valores por defecto son provisionales: se
 * reemplazan cuando la institución cierre D-04 (parciales y ponderaciones) y D-05 (tipos de actividad
 * que se crean automáticamente). Cambiar una regla no exige tocar el generador ni el validador.
 */
export interface ProposalPolicy {
  /** Suma esperada de las ponderaciones de las actividades de un mismo periodo de calificación (D-04). */
  periodWeightTotal: number;
  /** Diferencia aceptada al comparar sumas de ponderaciones (decimales). */
  weightTolerance: number;
  /** Tipos de elemento que se pueden crear en Moodle (D-05). */
  enabledItemTypes: readonly ProposalItemType[];
}

export const DEFAULT_PROPOSAL_POLICY: ProposalPolicy = {
  periodWeightTotal: 100,
  weightTolerance: 0.01,
  enabledItemTypes: Object.values(ProposalItemType),
};

/** Token de inyección de la política vigente. */
export const PROPOSAL_POLICY = Symbol("PROPOSAL_POLICY");
