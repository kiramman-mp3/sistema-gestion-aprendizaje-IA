import { BadRequestException } from "@nestjs/common";
import type { ProposalItemType } from "../generated/prisma/enums";
import type { ProposalItemInput } from "./proposal.dto";

/** Elemento listo para guardar: con id, posición y valores por defecto aplicados. */
export interface NormalizedItem {
  id: string;
  parentId: string | null;
  itemType: ProposalItemType;
  title: string;
  description: string | null;
  position: number;
  unitRef: string;
  learningOutcomeIds: string[];
  dueDate: string | null;
  weight: number | null;
}

/**
 * Valida la estructura de los elementos que envía el docente y completa lo que falta.
 *
 * - Una sección no tiene padre; cualquier otro elemento cuelga de una sección de la misma propuesta.
 * - Los ids no se repiten; los elementos sin id reciben uno nuevo.
 * - La posición es el orden del arreglo.
 * - `unitRef` ausente: el elemento hereda el de su sección, o conserva el que ya tenía.
 *
 * @param knownUnitRefs `unitRef` de los elementos ya guardados, por id.
 * @throws BadRequestException con `details` por cada problema encontrado.
 */
export function normalizeItems(
  inputs: readonly ProposalItemInput[],
  newId: () => string,
  knownUnitRefs: ReadonlyMap<string, string> = new Map(),
): NormalizedItem[] {
  const problems: { path: string; message: string }[] = [];
  const problem = (path: string, message: string) => problems.push({ path, message });

  const ids = inputs.map((input) => input.id ?? newId());
  const typeById = new Map<string, ProposalItemType>();
  ids.forEach((id, i) => {
    if (typeById.has(id)) problem(`items.${i}.id`, "El id está repetido.");
    typeById.set(id, inputs[i]!.itemType);
  });

  const unitRefById = new Map<string, string>();
  const unitRefOf = (index: number): string => {
    const id = ids[index]!;
    const cached = unitRefById.get(id);
    if (cached) return cached;
    const input = inputs[index]!;
    let unitRef = input.unitRef ?? knownUnitRefs.get(id);
    if (!unitRef && input.parentId) {
      const parentIndex = ids.indexOf(input.parentId);
      if (parentIndex >= 0 && inputs[parentIndex]!.itemType === "SECTION") {
        unitRef = unitRefOf(parentIndex);
      }
    }
    unitRef ??= `custom:${id}`;
    unitRefById.set(id, unitRef);
    return unitRef;
  };

  inputs.forEach((input, i) => {
    const parentId = input.parentId ?? null;
    if (input.itemType === "SECTION") {
      if (parentId !== null) problem(`items.${i}.parentId`, "Una sección no puede tener padre.");
    } else if (parentId === null) {
      problem(`items.${i}.parentId`, "Una actividad debe estar dentro de una sección.");
    } else if (typeById.get(parentId) !== "SECTION") {
      problem(`items.${i}.parentId`, "El padre debe ser una sección de esta propuesta.");
    }
  });

  if (problems.length > 0) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "La estructura de la propuesta no es válida.",
      details: problems,
    });
  }

  return inputs.map((input, i) => ({
    id: ids[i]!,
    parentId: input.parentId ?? null,
    itemType: input.itemType,
    title: input.title,
    description: input.description ?? null,
    position: i,
    unitRef: unitRefOf(i),
    learningOutcomeIds: [...new Set(input.learningOutcomeIds ?? [])],
    dueDate: input.dueDate ?? null,
    weight: input.weight ?? null,
  }));
}
