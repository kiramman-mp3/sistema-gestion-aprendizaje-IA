import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import type { AuthContext } from "../auth/auth-context";
import { PrismaService } from "../database/prisma.service";
import { IntegrationAccountService } from "../integrations/integration-account.service";
import { AnalyticsDataService } from "./analytics-data.service";
import type { AnalyticsDataset, Indicator } from "./analytics.types";
import { resolveRules, type StoredRule } from "./difficulty-rules";
import { evaluateSignals, type DifficultySignal } from "./difficulty-signals";
import { SnapshotsService } from "./snapshots.service";
import {
  computeCourseIndicators,
  computeStudentIndicators,
  dueAssignments,
  gradePercent,
} from "./indicators";

/** `components/schemas/CourseAnalytics` del contrato OpenAPI. */
export interface CourseAnalyticsDto {
  courseId: number;
  computedAt: string;
  indicators: Indicator[];
  signals: DifficultySignal[];
}

/** `components/schemas/StudentEvidence` del contrato OpenAPI. */
export interface StudentEvidenceDto {
  courseId: number;
  studentId: number;
  /** Datos tal como están en Moodle, sin interpretar: filas `{label, value}`. */
  observed: { label: string; value: string }[];
  computed: Indicator[];
  /** Lo que falta para concluir algo; nunca se rellena con suposiciones. */
  unknown: string[];
}

const fmtDate = (iso: string): string => iso.slice(0, 10);

/**
 * Analítica del curso y del estudiante (RF-15 a RF-17). Los datos salen de Moodle, los cálculos son
 * deterministas y cada indicador sin dato lleva `null`. Los nombres de los estudiantes no pasan por aquí:
 * solo ids.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly data: AnalyticsDataService,
    private readonly prisma: PrismaService,
    private readonly accounts: IntegrationAccountService,
    private readonly audit: AuditService,
    private readonly snapshots: SnapshotsService,
  ) {}

  async courseAnalytics(auth: AuthContext, now = new Date()): Promise<CourseAnalyticsDto> {
    const dataset = await this.data.load(auth, now);
    const rules = resolveRules(await this.storedRules(auth.courseId), auth.courseId);
    const signals = evaluateSignals(dataset, rules);

    await this.audit.record({
      action: "analytics.course_view",
      outcome: "SUCCESS",
      actorMoodleId: auth.moodleUserId,
      courseId: auth.courseId,
      resourceType: "course",
      metadata: { signals: signals.length },
    });
    const indicators = computeCourseIndicators(dataset);
    await this.snapshots.recordOncePerDay(auth, indicators, signals.length, now);
    return {
      courseId: auth.courseId,
      computedAt: now.toISOString(),
      indicators,
      signals,
    };
  }

  /**
   * Evidencias de un estudiante con lo observado, lo calculado y lo desconocido por separado (RF-17). Un
   * estudiante que no está matriculado en el curso responde 404, igual que uno que no existe.
   */
  async studentEvidence(
    auth: AuthContext,
    studentId: number,
    now = new Date(),
  ): Promise<StudentEvidenceDto> {
    const dataset = await this.data.load(auth, now);
    if (!dataset.studentIds.includes(studentId)) {
      throw new NotFoundException({
        code: "STUDENT_NOT_FOUND",
        message: "El estudiante no está en el curso.",
      });
    }

    await this.audit.record({
      action: "analytics.student_view",
      outcome: "SUCCESS",
      actorMoodleId: auth.moodleUserId,
      courseId: auth.courseId,
      resourceType: "student",
      resourceId: String(studentId),
    });
    return {
      courseId: auth.courseId,
      studentId,
      observed: observedFacts(dataset, studentId),
      computed: computeStudentIndicators(dataset, studentId),
      unknown: unknownFacts(dataset, studentId),
    };
  }

  private async storedRules(courseId: number): Promise<StoredRule[]> {
    const rows = await this.prisma.difficultyRule.findMany({
      where: {
        integrationAccountId: await this.accounts.currentId(),
        OR: [{ moodleCourseId: null }, { moodleCourseId: courseId }],
      },
      select: { rule: true, moodleCourseId: true, enabled: true, params: true },
    });
    return rows;
  }
}

function activityName(data: AnalyticsDataset, cmid: number): string {
  return data.activities.find((a) => a.cmid === cmid)?.name ?? `Actividad ${cmid}`;
}

/** Hechos de Moodle sobre el estudiante, sin interpretar. */
function observedFacts(
  data: AnalyticsDataset,
  studentId: number,
): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [];

  if (data.submissions) {
    const due = dueAssignments(data);
    const status = (cmid: number) =>
      data.submissions!.get(cmid)?.find((row) => row.studentid === studentId)?.status ?? "missing";
    const delivered = due.filter((a) => ["submitted", "graded"].includes(status(a.cmid)));
    const notDelivered = due.filter((a) => !delivered.includes(a));
    if (due.length > 0) {
      facts.push({
        label: "Tareas entregadas (vencidas)",
        value: `${delivered.length} de ${due.length}`,
      });
    }
    if (notDelivered.length > 0) {
      facts.push({
        label: "Tareas vencidas sin entrega",
        value: notDelivered.map((a) => a.name).join(", "),
      });
    }
  }

  for (const grade of (data.grades ?? []).filter(
    (g) => g.studentid === studentId && g.grade !== null,
  )) {
    facts.push({
      label: `Nota · ${activityName(data, grade.cmid)}`,
      value: grade.grademax !== null ? `${grade.grade} / ${grade.grademax}` : String(grade.grade),
    });
  }

  const pending = (data.pending ?? []).filter((p) => p.studentid === studentId);
  if (pending.length > 0) {
    facts.push({
      label: "Entregas sin calificar",
      value: pending.map((p) => activityName(data, p.cmid)).join(", "),
    });
  }

  const access = data.lastAccess?.find((row) => row.studentid === studentId);
  if (access) {
    facts.push({
      label: "Último acceso al curso",
      value: access.lastaccess ? fmtDate(access.lastaccess) : "Nunca ha entrado",
    });
  }
  return facts;
}

/** Lo que no se puede afirmar porque falta el dato, dicho explícitamente. */
function unknownFacts(data: AnalyticsDataset, studentId: number): string[] {
  const unknown: string[] = [];
  if (!data.submissions)
    unknown.push(
      "No se pudieron leer las entregas de Moodle: no se puede calcular el porcentaje de entregas.",
    );
  else if (dueAssignments(data).length === 0) {
    unknown.push(
      "Ninguna tarea visible ha vencido todavía: no se puede calcular el porcentaje de entregas.",
    );
  }
  if (!data.grades) {
    unknown.push("No se pudieron leer las notas de Moodle.");
  } else {
    const own = data.grades.filter((g) => g.studentid === studentId);
    if (!own.some((g) => gradePercent(g) !== null))
      unknown.push("El estudiante no tiene notas registradas.");
  }
  if (!data.completion) unknown.push("No se pudo leer la finalización de actividades.");
  if (!data.lastAccess) unknown.push("No se pudieron leer los accesos al curso.");
  if (data.units.length === 0) {
    unknown.push(
      "El curso no tiene un sílabo revisado: no hay unidades para calcular el rendimiento por unidad.",
    );
  } else if (data.mappings.length === 0) {
    unknown.push(
      "Las actividades no están relacionadas con unidades del sílabo: no se puede calcular el rendimiento por unidad.",
    );
  }
  return unknown;
}
