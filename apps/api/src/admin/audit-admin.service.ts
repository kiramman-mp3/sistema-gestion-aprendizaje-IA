import { BadRequestException, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../audit/audit.service";
import type { AuthContext } from "../auth/auth-context";
import { parseBody } from "../common/parse-body";
import { PrismaService } from "../database/prisma.service";

const positiveInt = z.coerce.number().int().positive().max(2_147_483_647);
const isoDate = z.iso.datetime({ offset: true });

/** Filtros de `GET /audit`. Todos son opcionales; sin ninguno se devuelven los eventos más recientes. */
export const auditQuerySchema = z.strictObject({
  courseId: positiveInt.optional(),
  actorId: positiveInt.optional(),
  /** Acción exacta (`proposal.publish`) o un dominio completo (`proposal.`). */
  action: z
    .string()
    .regex(/^[a-z][a-z0-9_.]{0,59}$/)
    .optional(),
  outcome: z.enum(["SUCCESS", "DENIED", "ERROR"]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** `components/schemas/AuditEvent` del contrato OpenAPI. */
export interface AuditEventDto {
  id: string;
  createdAt: string;
  action: string;
  outcome: "SUCCESS" | "DENIED" | "ERROR";
  actorMoodleId: number | null;
  courseId: number | null;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, string | number | boolean | null> | null;
}

export interface AuditPageDto {
  items: AuditEventDto[];
  /** Pasar como `cursor` para pedir la página siguiente; nulo si no hay más. */
  nextCursor: string | null;
}

const encodeCursor = (createdAt: Date, id: string): string =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [iso, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const createdAt = new Date(iso ?? "");
  return id && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : null;
}

/**
 * Consulta de la auditoría para el administrador institucional (CU-07, RF-19). Los eventos ya se guardan sin
 * nombres, notas ni texto de mensajes; aquí solo se filtran y se paginan. Consultar la auditoría también deja
 * un evento, para saber quién la miró.
 */
@Injectable()
export class AuditAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, rawQuery: unknown): Promise<AuditPageDto> {
    const query = parseBody(auditQuerySchema, rawQuery);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && !cursor) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "La petición no cumple el formato esperado.",
        details: [{ path: "cursor", message: "El cursor no es válido." }],
      });
    }

    const created: { gte?: Date; lte?: Date } = {};
    if (query.from) created.gte = new Date(query.from);
    if (query.to) created.lte = new Date(query.to);

    const and: object[] = [];
    if (cursor) {
      and.push({
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      });
    }

    const rows = await this.prisma.auditEvent.findMany({
      where: {
        ...(query.courseId ? { moodleCourseId: query.courseId } : {}),
        ...(query.actorId ? { actorMoodleId: query.actorId } : {}),
        ...(query.action
          ? query.action.endsWith(".")
            ? { action: { startsWith: query.action } }
            : { action: query.action }
          : {}),
        ...(query.outcome ? { outcome: query.outcome } : {}),
        ...(created.gte || created.lte ? { createdAt: created } : {}),
        ...(and.length ? { AND: and } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });

    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    await this.audit.record({
      action: "audit.query",
      outcome: "SUCCESS",
      actorMoodleId: auth.moodleUserId,
      courseId: auth.courseId,
      metadata: {
        results: page.length,
        filterCourse: query.courseId ?? null,
        filterActor: query.actorId ?? null,
        filterAction: query.action ?? null,
      },
    });

    return {
      items: page.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        action: row.action,
        outcome: row.outcome,
        actorMoodleId: row.actorMoodleId,
        courseId: row.moodleCourseId,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        metadata: (row.metadata as AuditEventDto["metadata"]) ?? null,
      })),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }
}
