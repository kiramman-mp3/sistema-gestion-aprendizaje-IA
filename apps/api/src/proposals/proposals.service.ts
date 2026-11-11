import { randomUUID } from "node:crypto";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { syllabusExtractionSchema } from "@smart-lms/contracts";
import { AuditService } from "../audit/audit.service";
import type { AuthContext } from "../auth/auth-context";
import { parseBody } from "../common/parse-body";
import { PrismaService } from "../database/prisma.service";
import type { Prisma } from "../generated/prisma/client";
import { generateProposalItems } from "./proposal-generator";
import { PROPOSAL_POLICY, type ProposalPolicy } from "./proposal-policy";
import { assertTransition, statusAfterEdit } from "./proposal-state-machine";
import { normalizeItems, type NormalizedItem } from "./proposal-structure";
import { findProposalIssues, type ProposalItemData } from "./proposal-validation";
import {
  createProposalSchema,
  toProposalDto,
  updateProposalSchema,
  type ProposalDto,
  type ProposalWithItems,
} from "./proposal.dto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cliente de Prisma o el de una transacción. */
export type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class ProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(PROPOSAL_POLICY) private readonly policy: ProposalPolicy,
  ) {}

  /**
   * Genera una propuesta a partir de una versión de la extracción (RF-07). Exige que el docente ya
   * haya revisado la extracción y avisa si el mismo sílabo ya tiene una propuesta.
   */
  async create(auth: AuthContext, body: unknown): Promise<ProposalDto> {
    const input = parseBody(createProposalSchema, body);

    const document = await this.prisma.syllabusDocument.findUnique({
      where: { id: input.syllabusId },
      select: { moodleCourseId: true, status: true, checksumSha256: true },
    });
    // Un sílabo de otro curso responde igual que uno inexistente (RF-02).
    if (!document || document.moodleCourseId !== auth.courseId) {
      throw new NotFoundException({ code: "SYLLABUS_NOT_FOUND", message: "El sílabo no existe." });
    }
    const extraction = await this.prisma.syllabusExtraction.findUnique({
      where: {
        documentId_version: { documentId: input.syllabusId, version: input.extractionVersion },
      },
      select: { id: true, content: true },
    });
    if (!extraction) {
      throw new NotFoundException({
        code: "EXTRACTION_NOT_FOUND",
        message: "La versión de la extracción no existe.",
      });
    }
    if (document.status !== "REVIEWED") {
      throw new ConflictException({
        code: "EXTRACTION_NOT_REVIEWED",
        message: "El docente debe revisar y guardar la extracción antes de generar la propuesta.",
      });
    }
    const content = syllabusExtractionSchema.safeParse(extraction.content);
    if (!content.success) {
      throw new ConflictException({
        code: "EXTRACTION_INVALID",
        message: "La extracción guardada no cumple el esquema v1.",
      });
    }

    if (!input.confirmDuplicate) {
      const existing = await this.prisma.courseProposal.findFirst({
        where: {
          moodleCourseId: auth.courseId,
          status: { not: "REJECTED" },
          extraction: { document: { checksumSha256: document.checksumSha256 } },
        },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException({
          code: "PROPOSAL_EXISTS",
          message: "Este sílabo ya tiene una propuesta. Envía confirmDuplicate para crear otra.",
          details: [{ path: "proposalId", message: existing.id }],
        });
      }
    }

    const drafts = generateProposalItems(content.data, {
      deriveActivitiesFromInstruments: this.policy.deriveActivitiesFromInstruments,
    });
    const idByKey = new Map(drafts.map((draft) => [draft.key, randomUUID()]));
    const proposalId = randomUUID();

    await this.prisma.$transaction(async (tx) => {
      await tx.courseProposal.create({
        data: {
          id: proposalId,
          extractionId: extraction.id,
          moodleCourseId: auth.courseId,
          createdBy: auth.moodleUserId,
          status: "DRAFT",
        },
      });
      await this.insertItems(
        tx,
        proposalId,
        drafts.map((draft) => ({
          id: idByKey.get(draft.key)!,
          parentId: draft.parentKey ? idByKey.get(draft.parentKey)! : null,
          itemType: draft.itemType,
          title: draft.title,
          description: draft.description,
          position: draft.position,
          unitRef: draft.unitRef,
          learningOutcomeIds: draft.learningOutcomeIds,
          dueDate: draft.dueDate,
          weight: draft.weight,
        })),
      );
      assertTransition("DRAFT", "NEEDS_REVIEW");
      await tx.courseProposal.update({
        where: { id: proposalId },
        data: { status: "NEEDS_REVIEW" },
      });
    });

    await this.audit.record({
      action: "proposal.create",
      outcome: "SUCCESS",
      actorMoodleId: auth.moodleUserId,
      courseId: auth.courseId,
      resourceType: "course_proposal",
      resourceId: proposalId,
      metadata: { extractionVersion: input.extractionVersion, itemCount: drafts.length },
    });
    return this.toDto(await this.reload(proposalId));
  }

  /**
   * La propuesta del curso del token con la actividad más reciente (sin contar las rechazadas), para retomarla al abrir
   * la página. Responde 404 si el curso no tiene ninguna.
   */
  async latest(auth: AuthContext): Promise<ProposalDto> {
    const latest = await this.prisma.courseProposal.findFirst({
      where: { moodleCourseId: auth.courseId, status: { not: "REJECTED" } },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (!latest) {
      throw new NotFoundException({
        code: "PROPOSAL_NOT_FOUND",
        message: "El curso no tiene propuestas.",
      });
    }
    return this.findOne(auth, latest.id);
  }

  /** Una propuesta de otro curso responde 404, igual que una inexistente (RF-02). */
  async findOne(auth: AuthContext, id: string): Promise<ProposalDto> {
    return this.toDto(await this.loadForCourse(auth, id));
  }

  /**
   * Reemplaza los elementos con los que envía el docente (RF-08). Una propuesta aprobada vuelve a
   * revisión: lo que se aprobó ya no es lo que se publicaría.
   */
  async update(auth: AuthContext, id: string, body: unknown): Promise<ProposalDto> {
    const input = parseBody(updateProposalSchema, body);
    const proposal = await this.loadForCourse(auth, id);
    const nextStatus = statusAfterEdit(proposal.status);

    const knownUnitRefs = new Map(proposal.items.map((item) => [item.id, item.unitRef]));
    const items = normalizeItems(input.items, randomUUID, knownUnitRefs);

    // Un id que ya pertenece a otra propuesta no se puede reutilizar.
    const taken = await this.prisma.proposalItem.findMany({
      where: { id: { in: items.map((item) => item.id) }, proposalId: { not: id } },
      select: { id: true },
    });
    if (taken.length > 0) {
      throw new ConflictException({
        code: "ITEM_ID_CONFLICT",
        message: "Uno de los ids de elemento ya se usa en otra propuesta.",
        details: taken.map((item) => ({ path: "items.id", message: item.id })),
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await this.moveStatus(tx, proposal.id, proposal.status, {
        status: nextStatus,
        // La aprobación ya no corresponde al contenido editado.
        ...(nextStatus !== proposal.status ? { approvedBy: null, approvedAt: null } : {}),
      });
      await tx.proposalItem.deleteMany({ where: { proposalId: id } });
      await this.insertItems(tx, id, items);
    });

    await this.audit.record({
      action: "proposal.update",
      outcome: "SUCCESS",
      actorMoodleId: auth.moodleUserId,
      courseId: auth.courseId,
      resourceType: "course_proposal",
      resourceId: id,
      metadata: { itemCount: items.length, status: nextStatus },
    });
    return this.toDto(await this.reload(id));
  }

  /** Aprueba una propuesta en revisión y registra quién y cuándo (RF-08). */
  async approve(auth: AuthContext, id: string): Promise<ProposalDto> {
    const proposal = await this.loadForCourse(auth, id);
    assertTransition(proposal.status, "APPROVED");

    const errors = this.issuesOf(proposal).filter((issue) => issue.severity === "error");
    if (errors.length > 0) {
      throw new ConflictException({
        code: "PROPOSAL_HAS_ERRORS",
        message: "La propuesta tiene errores que deben corregirse antes de aprobarla.",
        details: errors.map((issue) => ({
          path: issue.itemId ?? "proposal",
          message: issue.message,
        })),
      });
    }

    await this.moveStatus(this.prisma, id, proposal.status, {
      status: "APPROVED",
      approvedBy: auth.moodleUserId,
      approvedAt: new Date(),
    });
    await this.audit.record({
      action: "proposal.approve",
      outcome: "SUCCESS",
      actorMoodleId: auth.moodleUserId,
      courseId: auth.courseId,
      resourceType: "course_proposal",
      resourceId: id,
      metadata: { warnings: this.issuesOf(proposal).length },
    });
    return this.toDto(await this.reload(id));
  }

  // -------------------------------------------------------------------------------------------

  /** Una propuesta de otro curso responde 404, igual que una inexistente (RF-02). */
  async loadForCourse(auth: AuthContext, id: string): Promise<ProposalWithItems> {
    const proposal = UUID.test(id) ? await this.load(this.prisma, id) : null;
    if (!proposal || proposal.moodleCourseId !== auth.courseId) {
      throw new NotFoundException({
        code: "PROPOSAL_NOT_FOUND",
        message: "La propuesta no existe.",
      });
    }
    return proposal;
  }

  private load(db: Db, id: string): Promise<ProposalWithItems | null> {
    return db.courseProposal.findUnique({
      where: { id },
      include: {
        items: { orderBy: { position: "asc" } },
        extraction: { select: { version: true, documentId: true } },
        publishOperations: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true },
        },
      },
    });
  }

  /** Vuelve a leer una propuesta que se acaba de escribir. */
  private async reload(id: string): Promise<ProposalWithItems> {
    const proposal = await this.load(this.prisma, id);
    if (!proposal) throw new Error(`La propuesta ${id} desapareció después de guardarse.`);
    return proposal;
  }

  issuesOf(proposal: ProposalWithItems) {
    const data: ProposalItemData[] = proposal.items.map((item) => ({
      id: item.id,
      parentId: item.parentId,
      itemType: item.itemType,
      title: item.title,
      position: item.position,
      unitRef: item.unitRef,
      learningOutcomeIds: item.learningOutcomeIds,
      weight: item.weight === null ? null : Number(item.weight),
    }));
    return findProposalIssues(data, this.policy);
  }

  private toDto(proposal: ProposalWithItems): ProposalDto {
    return toProposalDto(proposal, this.issuesOf(proposal));
  }

  /**
   * Cambia el estado solo si nadie lo cambió desde que se leyó la propuesta: dos peticiones
   * simultáneas no pueden aprobar o editar la misma versión.
   */
  async moveStatus(
    db: Db,
    id: string,
    from: ProposalWithItems["status"],
    data: Prisma.CourseProposalUpdateManyMutationInput,
  ): Promise<void> {
    const result = await db.courseProposal.updateMany({ where: { id, status: from }, data });
    if (result.count !== 1) {
      throw new ConflictException({
        code: "PROPOSAL_CHANGED",
        message: "La propuesta cambió mientras se procesaba la petición. Vuelve a cargarla.",
      });
    }
  }

  /** Las secciones se insertan primero para que sus actividades puedan apuntar a ellas. */
  private async insertItems(
    db: Prisma.TransactionClient,
    proposalId: string,
    items: readonly NormalizedItem[],
  ): Promise<void> {
    const rows = items.map((item) => ({
      id: item.id,
      proposalId,
      parentId: item.parentId,
      itemType: item.itemType,
      title: item.title,
      description: item.description,
      position: item.position,
      unitRef: item.unitRef,
      learningOutcomeIds: item.learningOutcomeIds,
      dueDate: item.dueDate ? new Date(`${item.dueDate}T00:00:00.000Z`) : null,
      weight: item.weight,
    }));
    const sections = rows.filter((row) => row.itemType === "SECTION");
    const others = rows.filter((row) => row.itemType !== "SECTION");
    if (sections.length > 0) await db.proposalItem.createMany({ data: sections });
    if (others.length > 0) await db.proposalItem.createMany({ data: others });
  }
}
