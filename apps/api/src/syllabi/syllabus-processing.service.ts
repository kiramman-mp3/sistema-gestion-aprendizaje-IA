import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { DocumentTextJob } from "@smart-lms/contracts";
import { FlowProducer, Queue } from "bullmq";
import type { Env } from "../config/env";
import { PrismaService } from "../database/prisma.service";
import {
  bullConnection,
  DOCUMENT_TEXT_QUEUE,
  DOCUMENT_TEXT_RESULTS_QUEUE,
} from "../queue/queue.constants";

/** Reintentos del worker documental ante fallos transitorios (RF-04). */
const TEXT_JOB_ATTEMPTS = 3;

/**
 * Encola la extracción de texto de un sílabo y consulta su progreso. El estado de negocio vive en
 * PostgreSQL; la cola solo coordina la ejecución (ADR-004).
 */
@Injectable()
export class SyllabusProcessingService implements OnModuleDestroy {
  private readonly logger = new Logger(SyllabusProcessingService.name);
  private readonly flows?: FlowProducer;
  private readonly textQueue?: Queue;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    const redisUrl = config.get("REDIS_URL", { infer: true });
    if (!redisUrl) return;
    const connection = bullConnection(redisUrl);
    this.flows = new FlowProducer({ connection });
    this.textQueue = new Queue(DOCUMENT_TEXT_QUEUE, { connection });
  }

  /**
   * Encola el documento y lo marca `PROCESSING`. Si Redis no responde, el documento queda `UPLOADED`
   * y la tarea de mantenimiento lo vuelve a encolar; la carga no falla por eso.
   */
  async enqueue(job: DocumentTextJob): Promise<boolean> {
    if (!this.flows) {
      this.logger.warn("REDIS_URL no está definida; el sílabo no se procesará.");
      return false;
    }
    try {
      await this.flows.add({
        name: "persist-text",
        queueName: DOCUMENT_TEXT_RESULTS_QUEUE,
        // El id del documento como id del trabajo evita encolarlo dos veces.
        opts: {
          jobId: job.documentId,
          attempts: 5,
          backoff: { type: "exponential", delay: 2_000 },
          removeOnComplete: true,
          removeOnFail: { age: 7 * 24 * 3600 },
        },
        data: { documentId: job.documentId },
        children: [
          {
            name: "extract-text",
            queueName: DOCUMENT_TEXT_QUEUE,
            data: job,
            opts: {
              jobId: job.documentId,
              attempts: TEXT_JOB_ATTEMPTS,
              backoff: { type: "exponential", delay: 5_000 },
              // Si el hijo agota los reintentos, el padre igual se procesa y registra el fallo.
              ignoreDependencyOnFailure: true,
              removeOnComplete: { age: 3600 },
              removeOnFail: { age: 7 * 24 * 3600 },
            },
          },
        ],
      });
    } catch (error) {
      this.logger.error(`No se pudo encolar el sílabo ${job.documentId}: ${String(error)}`);
      return false;
    }
    await this.prisma.syllabusDocument.updateMany({
      where: { id: job.documentId, status: "UPLOADED" },
      data: { status: "PROCESSING", errorCode: null },
    });
    return true;
  }

  /** Progreso del worker (0–100), o `null` si el trabajo ya no está en la cola. */
  async progress(documentId: string): Promise<number | null> {
    if (!this.textQueue) return null;
    try {
      const job = await this.textQueue.getJob(documentId);
      return typeof job?.progress === "number" ? job.progress : null;
    } catch {
      return null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.flows?.close(), this.textQueue?.close()]);
  }
}
