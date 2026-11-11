import { Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../audit/audit.service";
import type { AuthContext } from "../auth/auth-context";
import { parseBody } from "../common/parse-body";
import { PrismaService } from "../database/prisma.service";
import {
  DIFFICULTY_RULE_TYPES,
  resolveRules,
  ruleParamsSchemas,
  type DifficultyRuleType,
  type StoredRule,
} from "../analytics/difficulty-rules";
import { IntegrationAccountService } from "../integrations/integration-account.service";

const courseIdSchema = z.coerce.number().int().positive().max(2_147_483_647);

/** Cuerpo de `PUT /admin/difficulty-rules/:rule`. `courseId` nulo configura la regla de toda la institución. */
export const putRuleSchema = z.strictObject({
  courseId: courseIdSchema.nullable(),
  enabled: z.boolean(),
  params: z.record(z.string(), z.unknown()).default({}),
});

export type RuleScope = "default" | "institution" | "course";

/** `components/schemas/DifficultyRuleConfig` del contrato OpenAPI. */
export interface DifficultyRuleDto {
  rule: DifficultyRuleType;
  /** De dónde sale la configuración: valor por defecto, regla institucional o regla propia del curso. */
  scope: RuleScope;
  enabled: boolean;
  params: Record<string, unknown>;
}

/**
 * Configuración de las reglas de las señales de dificultad (CU-06, RF-16). Una regla de un curso reemplaza a la
 * institucional del mismo tipo; sin ninguna se usa el valor por defecto. Cada cambio queda en la auditoría.
 */
@Injectable()
export class DifficultyRulesAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: IntegrationAccountService,
    private readonly audit: AuditService,
  ) {}

  /** Reglas efectivas de un curso, o las institucionales si no se indica curso. */
  async list(
    rawCourseId: unknown,
  ): Promise<{ courseId: number | null; rules: DifficultyRuleDto[] }> {
    const courseId = this.parseCourseId(rawCourseId);
    const stored = await this.stored(courseId);
    const effective = resolveRules(stored, courseId ?? -1);
    return {
      courseId,
      rules: effective.map((rule) => ({
        rule: rule.rule,
        scope: this.scopeOf(stored, rule.rule, courseId),
        enabled: rule.enabled,
        params: rule.params as Record<string, unknown>,
      })),
    };
  }

  async put(auth: AuthContext, ruleName: string, body: unknown): Promise<DifficultyRuleDto> {
    const rule = this.parseRule(ruleName);
    const { courseId, enabled, params } = parseBody(putRuleSchema, body);
    const parsed = parseBody(ruleParamsSchemas[rule], params);
    const accountId = await this.accounts.currentId();

    const existing = await this.prisma.difficultyRule.findFirst({
      where: { integrationAccountId: accountId, moodleCourseId: courseId, rule },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.difficultyRule.update({
        where: { id: existing.id },
        data: { enabled, params: parsed },
      });
    } else {
      await this.prisma.difficultyRule.create({
        data: {
          integrationAccountId: accountId,
          moodleCourseId: courseId,
          rule,
          enabled,
          params: parsed,
        },
      });
    }
    await this.audit.record({
      action: "rules.update",
      outcome: "SUCCESS",
      actorMoodleId: auth.moodleUserId,
      courseId: courseId ?? undefined,
      resourceType: "difficulty_rule",
      resourceId: rule,
      metadata: { scope: courseId === null ? "institution" : "course", enabled },
    });
    return {
      rule,
      scope: courseId === null ? "institution" : "course",
      enabled,
      params: parsed as Record<string, unknown>,
    };
  }

  /** Quita la regla del curso (vuelve a la institucional) o la institucional (vuelve al valor por defecto). */
  async remove(auth: AuthContext, ruleName: string, rawCourseId: unknown): Promise<void> {
    const rule = this.parseRule(ruleName);
    const courseId = this.parseCourseId(rawCourseId);
    const deleted = await this.prisma.difficultyRule.deleteMany({
      where: {
        integrationAccountId: await this.accounts.currentId(),
        moodleCourseId: courseId,
        rule,
      },
    });
    if (deleted.count === 0) {
      throw new NotFoundException({
        code: "RULE_NOT_FOUND",
        message: "Esa regla no tiene una configuración propia que quitar.",
      });
    }
    await this.audit.record({
      action: "rules.reset",
      outcome: "SUCCESS",
      actorMoodleId: auth.moodleUserId,
      courseId: courseId ?? undefined,
      resourceType: "difficulty_rule",
      resourceId: rule,
      metadata: { scope: courseId === null ? "institution" : "course" },
    });
  }

  private parseRule(name: string): DifficultyRuleType {
    if (!(DIFFICULTY_RULE_TYPES as readonly string[]).includes(name)) {
      throw new NotFoundException({ code: "RULE_NOT_FOUND", message: "La regla no existe." });
    }
    return name as DifficultyRuleType;
  }

  private parseCourseId(raw: unknown): number | null {
    if (raw === undefined || raw === "") return null;
    return parseBody(z.object({ courseId: courseIdSchema }), { courseId: raw }).courseId;
  }

  private async stored(courseId: number | null): Promise<StoredRule[]> {
    return this.prisma.difficultyRule.findMany({
      where: {
        integrationAccountId: await this.accounts.currentId(),
        OR: [
          { moodleCourseId: null },
          ...(courseId === null ? [] : [{ moodleCourseId: courseId }]),
        ],
      },
      select: { rule: true, moodleCourseId: true, enabled: true, params: true },
    });
  }

  private scopeOf(
    stored: StoredRule[],
    rule: DifficultyRuleType,
    courseId: number | null,
  ): RuleScope {
    if (courseId !== null && stored.some((r) => r.rule === rule && r.moodleCourseId === courseId)) {
      return "course";
    }
    return stored.some((r) => r.rule === rule && r.moodleCourseId === null)
      ? "institution"
      : "default";
  }
}
