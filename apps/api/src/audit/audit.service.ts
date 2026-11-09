import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { PrismaService } from "../database/prisma.service";

export type AuditOutcome = "SUCCESS" | "DENIED" | "ERROR";

/** Valores permitidos en `metadata`: solo escalares, para que no se cuelen objetos con datos personales. */
export type AuditMetadata = Record<string, string | number | boolean | null>;

export interface AuditEntry {
  /** Acción en notación `dominio.verbo`, por ejemplo `auth.denied` o `proposal.publish`. */
  action: string;
  outcome: AuditOutcome;
  actorMoodleId?: number;
  courseId?: number;
  resourceType?: string;
  resourceId?: string;
  metadata?: AuditMetadata;
}

const MAX_METADATA_VALUE_LENGTH = 200;

/**
 * Registro de auditoría (RF-19). Guarda quién, qué, dónde y con qué resultado; nunca nombres, notas,
 * tokens ni texto de mensajes. Un fallo al escribir se registra en el log y no interrumpe la petición.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = Boolean(config.get("DATABASE_URL", { infer: true }));
  }

  async record(entry: AuditEntry): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.prisma.auditEvent.create({
        data: {
          action: entry.action,
          outcome: entry.outcome,
          actorMoodleId: entry.actorMoodleId ?? null,
          moodleCourseId: entry.courseId ?? null,
          resourceType: entry.resourceType ?? null,
          resourceId: entry.resourceId ?? null,
          ...(entry.metadata ? { metadata: sanitize(entry.metadata) } : {}),
        },
      });
    } catch (error) {
      this.logger.error(
        `No se pudo registrar el evento de auditoría ${entry.action}: ${String(error)}`,
      );
    }
  }
}

function sanitize(metadata: AuditMetadata): AuditMetadata {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      typeof value === "string" ? value.slice(0, MAX_METADATA_VALUE_LENGTH) : value,
    ]),
  );
}
