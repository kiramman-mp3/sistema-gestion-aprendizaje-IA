import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import type { AuthContext } from "../auth/auth-context";
import { parseBody } from "../common/parse-body";
import type { Env } from "../config/env";
import { PrismaService } from "../database/prisma.service";
import { IntegrationAccountService } from "../integrations/integration-account.service";
import type { Indicator } from "./analytics.types";

/** Versión de la forma en que se guardan los valores; sube si cambia la fórmula de algún indicador. */
export const SNAPSHOT_FORMULA_VERSION = 1;

/** Máximo de snapshots que devuelve una consulta. */
const MAX_SNAPSHOTS = 366;

export const historyQuerySchema = z.strictObject({
  days: z.coerce.number().int().min(1).max(365).default(90),
});

/** Contenido de `analytics_snapshots.indicators`. */
interface StoredSnapshot {
  formula: number;
  signals: number;
  values: Record<string, number | null>;
}

/** `components/schemas/AnalyticsHistory` del contrato OpenAPI. */
export interface AnalyticsHistoryDto {
  courseId: number;
  snapshots: {
    takenAt: string;
    signals: number;
    indicators: { key: string; value: number | null }[];
  }[];
}

const utcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/**
 * Historial de los indicadores del curso (RF-15, ADR-018). No hay tarea programada: leer Moodle exige un
 * docente, así que el snapshot se guarda al abrir el panel, como mucho uno por día, curso y docente. Cada docente
 * ve solo los suyos, porque con grupos separados sus valores pueden diferir. Un día sin visita es un hueco, no un
 * valor inventado. Solo se guardan los números de los indicadores y la cantidad de señales: ni ids de
 * estudiantes ni nombres.
 */
@Injectable()
export class SnapshotsService {
  private readonly logger = new Logger(SnapshotsService.name);
  private readonly retentionDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: IntegrationAccountService,
    config: ConfigService<Env, true>,
  ) {
    this.retentionDays = config.get("ANALYTICS_SNAPSHOT_RETENTION_DAYS", { infer: true });
  }

  /**
   * Guarda el snapshot del día si aún no hay uno de este docente. Un fallo se registra y no interrumpe el panel.
   * Un curso sin ningún dato (todos los indicadores nulos) no deja snapshot: no aporta nada a la evolución.
   *
   * @returns Si se guardó uno nuevo.
   */
  async recordOncePerDay(
    auth: AuthContext,
    indicators: Indicator[],
    signals: number,
    now: Date,
  ): Promise<boolean> {
    if (indicators.every((indicator) => indicator.value === null)) return false;
    const stored: StoredSnapshot = {
      formula: SNAPSHOT_FORMULA_VERSION,
      signals,
      values: Object.fromEntries(indicators.map((i) => [i.key, i.value])),
    };
    try {
      const accountId = await this.accounts.currentId();
      const takenOn = utcDay(now);
      const existing = await this.prisma.analyticsSnapshot.findFirst({
        where: {
          integrationAccountId: accountId,
          moodleCourseId: auth.courseId,
          takenBy: auth.moodleUserId,
          takenOn,
        },
        select: { id: true },
      });
      if (existing) return false;
      await this.prisma.analyticsSnapshot.create({
        data: {
          integrationAccountId: accountId,
          moodleCourseId: auth.courseId,
          takenBy: auth.moodleUserId,
          takenOn,
          takenAt: now,
          indicators: stored as unknown as object,
        },
      });
      return true;
    } catch (error) {
      // Dos aperturas casi simultáneas pueden chocar con el índice único: la segunda no hace falta.
      if ((error as { code?: string }).code !== "P2002") {
        this.logger.warn(`No se pudo guardar el snapshot de indicadores: ${String(error)}`);
      }
      return false;
    }
  }

  /** Snapshots del docente en el curso, del más antiguo al más reciente. */
  async history(
    auth: AuthContext,
    rawQuery: unknown,
    now = new Date(),
  ): Promise<AnalyticsHistoryDto> {
    const { days } = parseBody(historyQuerySchema, rawQuery);
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.analyticsSnapshot.findMany({
      where: {
        integrationAccountId: await this.accounts.currentId(),
        moodleCourseId: auth.courseId,
        takenBy: auth.moodleUserId,
        takenAt: { gte: since },
      },
      orderBy: { takenAt: "asc" },
      take: MAX_SNAPSHOTS,
      select: { takenAt: true, indicators: true },
    });
    return {
      courseId: auth.courseId,
      snapshots: rows.flatMap((row) => {
        const stored = row.indicators as unknown as StoredSnapshot;
        if (stored?.formula !== SNAPSHOT_FORMULA_VERSION) return [];
        return [
          {
            takenAt: row.takenAt.toISOString(),
            signals: stored.signals,
            indicators: Object.entries(stored.values).map(([key, value]) => ({ key, value })),
          },
        ];
      }),
    };
  }

  /** Borra los snapshots más viejos que `ANALYTICS_SNAPSHOT_RETENTION_DAYS`. Es idempotente. */
  async purgeExpired(now = new Date()): Promise<number> {
    const limit = new Date(now.getTime() - this.retentionDays * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.analyticsSnapshot.deleteMany({
      where: { takenAt: { lt: limit } },
    });
    if (count > 0) this.logger.log(`Snapshots de analítica vencidos borrados: ${count}.`);
    return count;
  }
}
