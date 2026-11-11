import { ConflictException } from "@nestjs/common";
import { ProposalStatus } from "../generated/prisma/enums";
import {
  assertTransition,
  canTransition,
  EDITABLE_STATUSES,
  InvalidTransitionError,
  PROPOSAL_TRANSITIONS,
  statusAfterEdit,
} from "./proposal-state-machine";

const ALL = Object.values(ProposalStatus);

/** Pares permitidos según el diagrama de `docs/architecture/modelo-datos.md`. */
const ALLOWED: [ProposalStatus, ProposalStatus][] = [
  ["DRAFT", "NEEDS_REVIEW"],
  ["NEEDS_REVIEW", "DRAFT"],
  ["NEEDS_REVIEW", "APPROVED"],
  ["NEEDS_REVIEW", "REJECTED"],
  ["APPROVED", "NEEDS_REVIEW"],
  ["APPROVED", "PUBLISHING"],
  ["PUBLISHING", "PUBLISHED"],
  ["PUBLISHING", "FAILED"],
  ["FAILED", "PUBLISHING"],
];

describe("canTransition", () => {
  it.each(ALL.flatMap((from) => ALL.map((to) => [from, to] as const)))("%s → %s", (from, to) => {
    const expected = ALLOWED.some(([a, b]) => a === from && b === to);

    expect(canTransition(from, to)).toBe(expected);
  });

  it("define las transiciones de todos los estados", () => {
    expect(Object.keys(PROPOSAL_TRANSITIONS).sort()).toEqual([...ALL].sort());
  });

  it("PUBLISHED y REJECTED son finales", () => {
    expect(PROPOSAL_TRANSITIONS.PUBLISHED).toEqual([]);
    expect(PROPOSAL_TRANSITIONS.REJECTED).toEqual([]);
  });
});

describe("assertTransition", () => {
  it("no hace nada si la transición está permitida", () => {
    expect(() => assertTransition("NEEDS_REVIEW", "APPROVED")).not.toThrow();
  });

  it("rechaza DRAFT → PUBLISHED con 409 y el estado de origen y destino (RF-08)", () => {
    let error: unknown;
    try {
      assertTransition("DRAFT", "PUBLISHED");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidTransitionError);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as InvalidTransitionError).getStatus()).toBe(409);
    expect((error as InvalidTransitionError).getResponse()).toEqual({
      code: "INVALID_TRANSITION",
      message: "Una propuesta en estado DRAFT no puede pasar a PUBLISHED.",
    });
  });

  it("no se puede publicar sin aprobar, ni aprobar lo ya publicado", () => {
    expect(() => assertTransition("NEEDS_REVIEW", "PUBLISHING")).toThrow(InvalidTransitionError);
    expect(() => assertTransition("PUBLISHED", "APPROVED")).toThrow(InvalidTransitionError);
  });
});

describe("statusAfterEdit", () => {
  it("una propuesta aprobada vuelve a revisión", () => {
    expect(statusAfterEdit("APPROVED")).toBe("NEEDS_REVIEW");
  });

  it("un borrador o una propuesta en revisión conservan su estado", () => {
    expect(statusAfterEdit("DRAFT")).toBe("DRAFT");
    expect(statusAfterEdit("NEEDS_REVIEW")).toBe("NEEDS_REVIEW");
  });

  it.each(ALL.filter((status) => !EDITABLE_STATUSES.includes(status)))(
    "no se puede editar una propuesta %s",
    (status) => {
      expect(() => statusAfterEdit(status)).toThrow(ConflictException);
    },
  );
});
