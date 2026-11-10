import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AnalyticsService, type StudentEvidenceDto } from "../analytics/analytics.service";
import { UsageLimitExceededError } from "../assistant/usage-quota.service";
import { AuditService } from "../audit/audit.service";
import type { AuthContext } from "../auth/auth-context";
import type { Env } from "../config/env";
import { PrismaService } from "../database/prisma.service";
import type { Prisma } from "../generated/prisma/client";
import { IntegrationAccountService } from "../integrations/integration-account.service";
import { LlmError } from "../llm/llm.errors";
import { LlmService } from "../llm/llm.service";
import {
  recommendationContentSchema,
  validateRecommendationLanguage,
  type RecommendationContent,
} from "./pedagogical-language";
import { buildRecommendationPrompt, RECOMMENDATION_SYSTEM_PROMPT } from "./recommendation-prompt";

const DAY_MS = 24 * 60 * 60 * 1000;

/** `components/schemas/Recommendation` del contrato OpenAPI. */
export interface RecommendationDto extends RecommendationContent {
  id: string;
}

/**
 * Recomendaciones pedagógicas individuales (RF-18). Pasan por tres barreras antes de llegar al docente:
 * hay datos suficientes (si no, 422), el modelo no ve el id ni el nombre del estudiante, y el lenguaje se
 * valida (sin diagnósticos, etiquetas ni juicios) con un reintento. Lo que no se sabe se declara en
 * `missingInformation` con la lista de lo desconocido de las evidencias, aunque el modelo la omita.
 */
@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    private readonly analytics: AnalyticsService,
    private readonly llm: LlmService,
    private readonly prisma: PrismaService,
    private readonly accounts: IntegrationAccountService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async generate(
    auth: AuthContext,
    studentId: number,
    now = new Date(),
  ): Promise<RecommendationDto> {
    await this.assertWithinLimit(auth.moodleUserId, now);
    const evidence = await this.analytics.studentEvidence(auth, studentId, now);
    assertEnoughData(evidence);

    const content = await this.writeSafely(auth, evidence);
    const final: RecommendationContent = {
      ...content,
      // Lo desconocido se declara siempre, aunque el modelo no lo mencione.
      missingInformation: [...new Set([...content.missingInformation, ...evidence.unknown])],
    };

    const row = await this.prisma.pedagogicalRecommendation.create({
      data: {
        integrationAccountId: await this.accounts.currentId(),
        moodleCourseId: auth.courseId,
        moodleStudentId: studentId,
        requestedBy: auth.moodleUserId,
        evidence: {
          observed: evidence.observed,
          computed: evidence.computed,
          unknown: evidence.unknown,
        } as unknown as Prisma.InputJsonValue,
        content: final as unknown as Prisma.InputJsonValue,
        status: "GENERATED",
      },
      select: { id: true },
    });
    await this.record(auth, "SUCCESS", {
      observed: evidence.observed.length,
      unknown: evidence.unknown.length,
    });
    return { id: row.id, ...final };
  }

  /** Pide la recomendación y la valida; si el lenguaje no es aceptable, reintenta una vez diciendo en qué campos. */
  private async writeSafely(
    auth: AuthContext,
    evidence: StudentEvidenceDto,
  ): Promise<RecommendationContent> {
    let violations: ReturnType<typeof validateRecommendationLanguage> = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      let content: RecommendationContent;
      try {
        ({ data: content } = await this.llm.generateStructured({
          purpose: "pedagogical_recommendation",
          system: RECOMMENDATION_SYSTEM_PROMPT,
          prompt: buildRecommendationPrompt(evidence, violations),
          schema: recommendationContentSchema,
          schemaName: "pedagogical_recommendation_v1",
        }));
      } catch (error) {
        await this.record(auth, "ERROR", {
          errorCode: error instanceof LlmError ? error.code : "UNKNOWN",
        });
        throw this.unavailable();
      }
      violations = validateRecommendationLanguage(content);
      if (violations.length === 0) return content;
      this.logger.warn(
        `Recomendación rechazada por lenguaje en ${violations.length} campo(s); intento ${attempt + 1}.`,
      );
    }
    // Solo rutas y tipos: el término exacto puede citar texto de las evidencias.
    await this.record(auth, "ERROR", {
      errorCode: "UNSAFE_LANGUAGE",
      violations: violations.length,
    });
    throw this.unavailable();
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: "AI_PROVIDER_UNAVAILABLE",
      message:
        "No se pudo generar una recomendación en este momento. Inténtalo de nuevo en unos minutos.",
    });
  }

  /** Tope diario de recomendaciones por docente (RNF-07): cada una cuesta una o dos llamadas al proveedor. */
  private async assertWithinLimit(moodleUserId: number, now: Date): Promise<void> {
    const since = new Date(now.getTime() - DAY_MS);
    const where = { requestedBy: moodleUserId, createdAt: { gte: since } };
    const used = await this.prisma.pedagogicalRecommendation.count({ where });
    if (used < this.config.get("AI_DAILY_RECOMMENDATIONS_PER_TEACHER", { infer: true })) return;

    const oldest = await this.prisma.pedagogicalRecommendation.findFirst({
      where,
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    const releaseAt = (oldest?.createdAt.getTime() ?? now.getTime()) + DAY_MS;
    throw new UsageLimitExceededError(Math.max(60, (releaseAt - now.getTime()) / 1000));
  }

  private async record(
    auth: AuthContext,
    outcome: "SUCCESS" | "ERROR",
    metadata: Record<string, string | number>,
  ): Promise<void> {
    await this.audit
      .record({
        action: "recommendation.generate",
        outcome,
        actorMoodleId: auth.moodleUserId,
        courseId: auth.courseId,
        resourceType: "pedagogical_recommendation",
        metadata,
      })
      .catch((error: unknown) =>
        this.logger.error(`No se pudo auditar la recomendación: ${String(error)}`),
      );
  }
}

/** Sin entregas ni notas legibles no hay evidencia para recomendar: se pide completar los datos. */
function assertEnoughData(evidence: StudentEvidenceDto): void {
  const has = (key: string) => evidence.computed.find((i) => i.key === key)?.value != null;
  if (has("delivery_rate") || has("average_grade_percent")) return;
  throw new UnprocessableEntityException({
    code: "INSUFFICIENT_DATA",
    message: "No hay datos suficientes para recomendar: faltan entregas y notas del estudiante.",
    details: evidence.unknown.map((message) => ({ path: "evidence", message })),
  });
}
