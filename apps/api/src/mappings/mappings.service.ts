import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { syllabusExtractionSchema } from "@smart-lms/contracts";
import { AuditService } from "../audit/audit.service";
import type { AuthContext } from "../auth/auth-context";
import { parseBody } from "../common/parse-body";
import { PrismaService } from "../database/prisma.service";
import { IntegrationAccountService } from "../integrations/integration-account.service";
import {
  saveMappingSchema,
  type MappingDto,
  type MappingOverviewDto,
  type OutcomeDto,
  type UnitDto,
} from "./mapping.dto";

interface ReviewedSyllabus {
  syllabusId: string;
  extractionVersion: number;
  units: UnitDto[];
  outcomes: OutcomeDto[];
}

/**
 * Relación entre las actividades que ya existen en Moodle y las unidades y resultados de aprendizaje del
 * sílabo revisado. Es la base de los indicadores por unidad (Sprint 10) y de la herramienta
 * `get_unit_performance` del chat.
 *
 * Las actividades creadas al publicar una propuesta se relacionan solas (`PROPOSAL`); el docente completa
 * el resto a mano (`MANUAL`), y lo que elige a mano no se sobrescribe al publicar.
 */
@Injectable()
export class MappingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: IntegrationAccountService,
    private readonly audit: AuditService,
  ) {}

  /** Unidades y resultados del sílabo revisado, y lo ya relacionado en el curso. */
  async overview(auth: AuthContext): Promise<MappingOverviewDto> {
    const syllabus = await this.latestReviewed(auth.courseId);
    const rows = await this.prisma.activityUnitMapping.findMany({
      where: { moodleCourseId: auth.courseId },
      orderBy: { moodleCmId: "asc" },
      select: { moodleCmId: true, unitRef: true, learningOutcomeIds: true, source: true },
    });
    return {
      syllabusId: syllabus?.syllabusId ?? null,
      extractionVersion: syllabus?.extractionVersion ?? null,
      units: syllabus?.units ?? [],
      outcomes: syllabus?.outcomes ?? [],
      mappings: rows.map(toMappingDto),
    };
  }

  /** Relaciona una actividad con una unidad y sus resultados de aprendizaje. */
  async save(auth: AuthContext, cmId: string, body: unknown): Promise<MappingDto> {
    const moodleCmId = parseCmId(cmId);
    const input = parseBody(saveMappingSchema, body);
    const syllabus = await this.latestReviewed(auth.courseId);
    if (!syllabus) {
      throw new ConflictException({
        code: "NO_REVIEWED_SYLLABUS",
        message: "El curso no tiene un sílabo revisado: no hay unidades a las que relacionar.",
      });
    }

    const problems: { path: string; message: string }[] = [];
    if (!syllabus.units.some((unit) => unit.unitRef === input.unitRef)) {
      problems.push({ path: "unitRef", message: "La unidad no existe en el sílabo revisado." });
    }
    const known = new Set(syllabus.outcomes.map((outcome) => outcome.id));
    input.learningOutcomeIds.forEach((id, i) => {
      if (!known.has(id)) {
        problems.push({
          path: `learningOutcomeIds.${i}`,
          message: "El resultado de aprendizaje no existe en el sílabo revisado.",
        });
      }
    });
    if (problems.length > 0) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "La relación no es válida.",
        details: problems,
      });
    }

    const learningOutcomeIds = [...new Set(input.learningOutcomeIds)];
    const row = await this.prisma.activityUnitMapping.upsert({
      where: { moodleCourseId_moodleCmId: { moodleCourseId: auth.courseId, moodleCmId } },
      create: {
        integrationAccountId: await this.accounts.currentId(),
        moodleCourseId: auth.courseId,
        moodleCmId,
        unitRef: input.unitRef,
        learningOutcomeIds,
        source: "MANUAL",
      },
      update: { unitRef: input.unitRef, learningOutcomeIds, source: "MANUAL" },
      select: { moodleCmId: true, unitRef: true, learningOutcomeIds: true, source: true },
    });
    await this.record(auth, "mapping.save", moodleCmId);
    return toMappingDto(row);
  }

  /** Quita la relación de una actividad. */
  async remove(auth: AuthContext, cmId: string): Promise<void> {
    const moodleCmId = parseCmId(cmId);
    const result = await this.prisma.activityUnitMapping.deleteMany({
      where: { moodleCourseId: auth.courseId, moodleCmId },
    });
    if (result.count === 0) {
      throw new NotFoundException({
        code: "MAPPING_NOT_FOUND",
        message: "La actividad no está relacionada con ninguna unidad.",
      });
    }
    await this.record(auth, "mapping.remove", moodleCmId);
  }

  private record(auth: AuthContext, action: string, moodleCmId: number): Promise<void> {
    return this.audit.record({
      action,
      outcome: "SUCCESS",
      actorMoodleId: auth.moodleUserId,
      courseId: auth.courseId,
      resourceType: "activity_unit_mapping",
      resourceId: String(moodleCmId),
    });
  }

  /** El sílabo más reciente del curso que el docente ya revisó, con sus unidades y resultados. */
  private async latestReviewed(courseId: number): Promise<ReviewedSyllabus | null> {
    const document = await this.prisma.syllabusDocument.findFirst({
      where: { moodleCourseId: courseId, status: "REVIEWED" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        extractions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { version: true, content: true },
        },
      },
    });
    const extraction = document?.extractions[0];
    if (!document || !extraction) return null;
    const content = syllabusExtractionSchema.safeParse(extraction.content);
    if (!content.success) return null;

    const units = content.data.gradingPeriods.flatMap((period, p) =>
      period.units.map((unit, u) => ({
        unitRef: `gradingPeriods[${p}].units[${u}]`,
        title: unit.title,
        periodName: period.name,
        learningOutcomeIds: unit.learningOutcomeIds,
      })),
    );
    return {
      syllabusId: document.id,
      extractionVersion: extraction.version,
      units,
      outcomes: content.data.learningOutcomes.map(({ id, description }) => ({ id, description })),
    };
  }
}

function toMappingDto(row: {
  moodleCmId: number;
  unitRef: string;
  learningOutcomeIds: string[];
  source: "PROPOSAL" | "MANUAL";
}): MappingDto {
  return {
    moodleCmId: row.moodleCmId,
    unitRef: row.unitRef,
    learningOutcomeIds: row.learningOutcomeIds,
    source: row.source,
  };
}

/** Un id de actividad de Moodle es un entero positivo; cualquier otra cosa se rechaza. */
function parseCmId(value: string): number {
  if (!/^[1-9]\d{0,9}$/.test(value)) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "El id de la actividad no es válido.",
      details: [{ path: "cmId", message: "Debe ser un entero positivo." }],
    });
  }
  return Number(value);
}
