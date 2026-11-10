import { Injectable, Logger } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import type { ProposalItemType } from "../generated/prisma/enums";
import {
  MoodleApiError,
  MoodlePermissionError,
  MoodleResponseError,
  MoodleUnavailableError,
} from "../integrations/moodle/moodle.errors";
import { IntegrationAccountService } from "../integrations/integration-account.service";
import { MoodleService } from "../integrations/moodle/moodle.service";
import type { PublishableModule } from "../integrations/moodle/moodle.types";

/** Elemento de Moodle que crea cada tipo de elemento de la propuesta (D-05, provisional). */
export const MODULE_OF_ITEM_TYPE: Record<
  Exclude<ProposalItemType, "SECTION">,
  PublishableModule
> = {
  ASSIGN: "assign",
  FORUM: "forum",
  QUIZ: "quiz",
  LABEL: "label",
  PAGE: "page",
};

/** Motivo, sin datos internos, que queda en `publish_error` y se muestra al docente. */
export function describeFailure(error: unknown): string {
  if (error instanceof MoodlePermissionError) return "MOODLE_PERMISSION";
  if (error instanceof MoodleUnavailableError) return "MOODLE_UNAVAILABLE";
  if (error instanceof MoodleApiError) return `MOODLE_ERROR:${error.errorcode}`.slice(0, 100);
  if (error instanceof MoodleResponseError) return "MOODLE_BAD_RESPONSE";
  return "PUBLISH_ERROR";
}

/**
 * Publica en Moodle los elementos de una propuesta aprobada, uno por uno (RF-09).
 *
 * Es seguro repetirlo en cualquier punto:
 * - Los elementos ya `CREATED` se saltan.
 * - Moodle reconoce un elemento por su id: si la petición anterior se aplicó pero la respuesta se perdió,
 *   Moodle devuelve lo que ya creó y no lo duplica.
 *
 * Se detiene en el primer fallo: las actividades dependen de su sección, y así el docente ve un único
 * punto de corte. El fallo queda en el elemento y la propuesta pasa a `FAILED`, desde donde se reanuda.
 */
@Injectable()
export class ProposalPublisher {
  private readonly logger = new Logger(ProposalPublisher.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly moodle: MoodleService,
    private readonly audit: AuditService,
    private readonly accounts: IntegrationAccountService,
  ) {}

  async run(operationId: string): Promise<void> {
    const operation = await this.prisma.publishOperation.findUnique({
      where: { id: operationId },
      include: {
        proposal: {
          include: { items: { orderBy: { position: "asc" } } },
        },
      },
    });
    // Un trabajo repetido por la cola no vuelve a ejecutar una operación terminada.
    if (!operation || operation.status !== "RUNNING") return;

    const { proposal } = operation;
    const moodleIdOf = new Map(
      proposal.items
        .filter((item) => item.moodleItemId !== null)
        .map((i) => [i.id, i.moodleItemId!]),
    );
    let created = 0;
    let failure: { itemId: string; error: string } | null = null;

    for (const item of proposal.items) {
      if (item.publishStatus === "CREATED") continue;
      try {
        const moodleId = await this.publishItem(
          operation.requestedBy,
          proposal.moodleCourseId,
          item,
          moodleIdOf,
        );
        moodleIdOf.set(item.id, moodleId);
        await this.prisma.proposalItem.update({
          where: { id: item.id },
          data: { publishStatus: "CREATED", moodleItemId: moodleId, publishError: null },
        });
        created += 1;
        await this.mapActivity(proposal.moodleCourseId, item, moodleId);
        await this.prisma.publishOperation.update({
          where: { id: operation.id },
          data: { createdCount: created },
        });
      } catch (error) {
        const reason = describeFailure(error);
        // El mensaje de un error de Moodle no incluye el token ni la URL (ver moodle.errors.ts).
        this.logger.warn(
          `Publicación ${operation.id}: falló el elemento ${item.id} (${reason}): ${String(error)}`,
        );
        await this.prisma.proposalItem.update({
          where: { id: item.id },
          data: { publishStatus: "FAILED", publishError: reason },
        });
        failure = { itemId: item.id, error: reason };
        break;
      }
    }

    await this.finish(operation.id, proposal.id, created, failure);
    await this.audit.record({
      action: "proposal.publish.finished",
      outcome: failure ? "ERROR" : "SUCCESS",
      actorMoodleId: operation.requestedBy,
      courseId: proposal.moodleCourseId,
      resourceType: "course_proposal",
      resourceId: proposal.id,
      metadata: { created, failed: failure ? 1 : 0, ...(failure ? { reason: failure.error } : {}) },
    });
  }

  /**
   * Relaciona la actividad creada con la unidad de la que salió, para los indicadores por unidad. Lo que el
   * docente ya relacionó a mano no se sobrescribe (`skipDuplicates`), y un fallo aquí no detiene la
   * publicación: la relación se puede completar después en la pantalla de actividades.
   */
  private async mapActivity(
    courseId: number,
    item: { itemType: ProposalItemType; unitRef: string; learningOutcomeIds: string[] },
    cmId: number,
  ): Promise<void> {
    // Las secciones no son actividades; una unidad creada por el docente (`custom:`) no existe en el sílabo.
    if (item.itemType === "SECTION" || item.unitRef.startsWith("custom:")) return;
    try {
      await this.prisma.activityUnitMapping.createMany({
        data: [
          {
            integrationAccountId: await this.accounts.currentId(),
            moodleCourseId: courseId,
            moodleCmId: cmId,
            unitRef: item.unitRef,
            learningOutcomeIds: item.learningOutcomeIds,
            source: "PROPOSAL",
          },
        ],
        skipDuplicates: true,
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo relacionar la actividad ${cmId} con su unidad: ${String(error)}`,
      );
    }
  }

  private async publishItem(
    userId: number,
    courseId: number,
    item: {
      id: string;
      parentId: string | null;
      itemType: ProposalItemType;
      title: string;
      description: string | null;
      dueDate: Date | null;
    },
    moodleIdOf: ReadonlyMap<string, number>,
  ): Promise<number> {
    if (item.itemType === "SECTION") {
      const section = await this.moodle.publishSection({
        userId,
        courseId,
        itemId: item.id,
        name: item.title,
        summary: item.description,
      });
      return section.sectionid;
    }

    const sectionId = item.parentId ? moodleIdOf.get(item.parentId) : undefined;
    if (sectionId === undefined) {
      // Las secciones se publican antes que sus actividades; si falta, la sección falló antes.
      throw new Error("La sección de la actividad no está publicada.");
    }
    const module = await this.moodle.publishModule({
      userId,
      courseId,
      itemId: item.id,
      sectionId,
      module: MODULE_OF_ITEM_TYPE[item.itemType],
      name: item.title,
      intro: item.description,
      dueDate: item.dueDate ? item.dueDate.toISOString().slice(0, 10) : null,
    });
    return module.cmid;
  }

  /** Cierra la operación y mueve la propuesta a `PUBLISHED` o `FAILED`, solo si sigue `PUBLISHING`. */
  private async finish(
    operationId: string,
    proposalId: string,
    created: number,
    failure: { itemId: string; error: string } | null,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.publishOperation.update({
        where: { id: operationId },
        data: {
          status: failure ? "FAILED" : "SUCCEEDED",
          createdCount: created,
          failedCount: failure ? 1 : 0,
          finishedAt: now,
        },
      });
      await tx.courseProposal.updateMany({
        where: { id: proposalId, status: "PUBLISHING" },
        data: failure ? { status: "FAILED" } : { status: "PUBLISHED", publishedAt: now },
      });
    });
  }
}
