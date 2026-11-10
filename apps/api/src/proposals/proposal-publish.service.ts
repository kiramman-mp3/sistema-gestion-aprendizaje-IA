import { randomUUID } from "node:crypto";
import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import type { AuthContext } from "../auth/auth-context";
import { parseBody } from "../common/parse-body";
import { PrismaService } from "../database/prisma.service";
import type { PublishOperation } from "../generated/prisma/client";
import { PublishDispatcher } from "./publish-dispatcher";
import {
  idempotencyKeySchema,
  publishBodySchema,
  toPublishOperationDto,
  type PublishOperationDto,
} from "./publish.dto";
import { assertTransition } from "./proposal-state-machine";
import { ProposalsService } from "./proposals.service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ProposalPublishService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly proposals: ProposalsService,
    private readonly dispatcher: PublishDispatcher,
    private readonly audit: AuditService,
  ) {}

  /**
   * Inicia la publicación de una propuesta aprobada, o reanuda una fallida (RF-09).
   *
   * Repetir la petición con la misma `Idempotency-Key` devuelve la misma operación y no publica de
   * nuevo. Una clave distinta sobre una propuesta que ya se está publicando o se publicó responde 409.
   */
  async start(
    auth: AuthContext,
    proposalId: string,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<PublishOperationDto> {
    const key = parseBody(idempotencyKeySchema, idempotencyKey);
    parseBody(publishBodySchema, body);
    const proposal = await this.proposals.loadForCourse(auth, proposalId);

    const existing = await this.prisma.publishOperation.findUnique({
      where: { idempotencyKey: key },
    });
    if (existing) return this.replay(existing, proposal);

    assertTransition(proposal.status, "PUBLISHING");
    // La política pudo cambiar desde la aprobación: se revisa otra vez antes de crear nada.
    const errors = this.proposals.issuesOf(proposal).filter((issue) => issue.severity === "error");
    if (errors.length > 0) {
      throw new ConflictException({
        code: "PROPOSAL_HAS_ERRORS",
        message: "La propuesta tiene errores que deben corregirse antes de publicarla.",
        details: errors.map((issue) => ({
          path: issue.itemId ?? "proposal",
          message: issue.message,
        })),
      });
    }

    let operation: PublishOperation;
    try {
      operation = await this.prisma.$transaction(async (tx) => {
        await this.proposals.moveStatus(tx, proposal.id, proposal.status, { status: "PUBLISHING" });
        // Al reanudar, los elementos que fallaron vuelven a intentarse.
        await tx.proposalItem.updateMany({
          where: { proposalId: proposal.id, publishStatus: "FAILED" },
          data: { publishStatus: "PENDING", publishError: null },
        });
        return tx.publishOperation.create({
          data: {
            id: randomUUID(),
            proposalId: proposal.id,
            idempotencyKey: key,
            requestedBy: auth.moodleUserId,
          },
        });
      });
    } catch (error) {
      // Dos peticiones simultáneas con la misma clave: la segunda no creó nada, devuelve la primera.
      const raced = await this.prisma.publishOperation.findUnique({
        where: { idempotencyKey: key },
      });
      if (raced) return this.replay(raced, proposal);
      throw error;
    }

    await this.audit.record({
      action: "proposal.publish",
      outcome: "SUCCESS",
      actorMoodleId: auth.moodleUserId,
      courseId: auth.courseId,
      resourceType: "course_proposal",
      resourceId: proposal.id,
      metadata: {
        operationId: operation.id,
        itemCount: proposal.items.length,
        resumed: proposal.status === "FAILED",
      },
    });

    try {
      await this.dispatcher.dispatch(operation.id);
    } catch {
      // Sin cola no se publica nada: la propuesta queda `FAILED` para reanudarla cuando vuelva.
      await this.abandon(operation.id, proposal.id);
      throw new ServiceUnavailableException({
        code: "PUBLISH_QUEUE_UNAVAILABLE",
        message: "No se pudo iniciar la publicación. Inténtalo de nuevo en unos minutos.",
      });
    }
    return toPublishOperationDto(operation, proposal.items.length, []);
  }

  /** Progreso y resultado de una publicación. */
  async getOperation(
    auth: AuthContext,
    proposalId: string,
    operationId: string,
  ): Promise<PublishOperationDto> {
    const proposal = await this.proposals.loadForCourse(auth, proposalId);
    const operation = UUID.test(operationId)
      ? await this.prisma.publishOperation.findUnique({ where: { id: operationId } })
      : null;
    if (!operation || operation.proposalId !== proposal.id) {
      throw new NotFoundException({
        code: "PUBLISH_OPERATION_NOT_FOUND",
        message: "La operación de publicación no existe.",
      });
    }
    return this.toDto(operation, proposal);
  }

  private replay(
    operation: PublishOperation,
    proposal: Awaited<ReturnType<ProposalsService["loadForCourse"]>>,
  ): PublishOperationDto {
    if (operation.proposalId !== proposal.id) {
      throw new ConflictException({
        code: "IDEMPOTENCY_KEY_REUSED",
        message: "La clave de idempotencia ya se usó en otra propuesta.",
      });
    }
    return this.toDto(operation, proposal);
  }

  private toDto(
    operation: PublishOperation,
    proposal: Awaited<ReturnType<ProposalsService["loadForCourse"]>>,
  ): PublishOperationDto {
    const failures = proposal.items
      .filter((item) => item.publishStatus === "FAILED")
      .map((item) => ({ itemId: item.id, error: item.publishError ?? "PUBLISH_ERROR" }));
    return toPublishOperationDto(operation, proposal.items.length, failures);
  }

  /** La operación no llegó a la cola: se cierra como fallida y la propuesta se puede reanudar. */
  private async abandon(operationId: string, proposalId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.publishOperation.update({
        where: { id: operationId },
        data: { status: "FAILED", finishedAt: new Date() },
      });
      await tx.courseProposal.updateMany({
        where: { id: proposalId, status: "PUBLISHING" },
        data: { status: "FAILED" },
      });
    });
  }
}
