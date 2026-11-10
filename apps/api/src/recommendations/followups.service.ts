import { Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../audit/audit.service";
import type { AuthContext } from "../auth/auth-context";
import { parseBody } from "../common/parse-body";
import { PrismaService } from "../database/prisma.service";

const followupSchema = z.object({
  actionTaken: z.string().trim().min(1).max(2000),
  observedResult: z.string().trim().max(2000).nullish(),
});

export interface FollowupDto {
  id: string;
  recommendationId: string;
  createdAt: string;
}

/** Seguimiento docente de una recomendación pedagógica (RF-20). */
@Injectable()
export class FollowupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Registra lo que hizo el docente y lo que observó. Solo se puede dar seguimiento a una recomendación
   * propia del curso del token: una ajena responde 404, igual que una inexistente, para no revelar que existe.
   */
  async add(auth: AuthContext, recommendationId: string, body: unknown): Promise<FollowupDto> {
    const input = parseBody(followupSchema, body);
    const recommendation = /^[0-9a-f-]{36}$/i.test(recommendationId)
      ? await this.prisma.pedagogicalRecommendation.findUnique({
          where: { id: recommendationId },
          select: { id: true, moodleCourseId: true, requestedBy: true },
        })
      : null;
    if (
      !recommendation ||
      recommendation.moodleCourseId !== auth.courseId ||
      recommendation.requestedBy !== auth.moodleUserId
    ) {
      throw new NotFoundException({
        code: "RECOMMENDATION_NOT_FOUND",
        message: "La recomendación no existe.",
      });
    }

    const followup = await this.prisma.recommendationFollowup.create({
      data: {
        recommendationId: recommendation.id,
        teacherId: auth.moodleUserId,
        actionTaken: input.actionTaken,
        observedResult: input.observedResult || null,
      },
      select: { id: true, recommendationId: true, createdAt: true },
    });
    // Solo el id: lo que escribió el docente puede nombrar a un estudiante.
    await this.audit.record({
      action: "recommendation.followup",
      outcome: "SUCCESS",
      actorMoodleId: auth.moodleUserId,
      courseId: auth.courseId,
      resourceType: "pedagogical_recommendation",
      resourceId: recommendation.id,
    });
    return {
      id: followup.id,
      recommendationId: followup.recommendationId,
      createdAt: followup.createdAt.toISOString(),
    };
  }
}
