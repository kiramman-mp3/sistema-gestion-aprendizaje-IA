import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue, Worker, type Job } from "bullmq";
import type { Env } from "../config/env";
import { bullConnection } from "../queue/queue.constants";
import { ConversationMaintenanceService } from "./conversation-maintenance.service";
import { SyllabusMaintenanceService } from "./syllabus-maintenance.service";

export const MAINTENANCE_QUEUE = "maintenance";

/**
 * Programa las tareas de mantenimiento con los planificadores de BullMQ. Con varias instancias del
 * backend, cada ejecución la toma una sola.
 */
@Injectable()
export class MaintenanceWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceWorker.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly maintenance: SyllabusMaintenanceService,
    private readonly conversations: ConversationMaintenanceService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get("REDIS_URL", { infer: true });
    if (!redisUrl) return;
    const connection = bullConnection(redisUrl);
    this.queue = new Queue(MAINTENANCE_QUEUE, { connection });
    this.worker = new Worker(MAINTENANCE_QUEUE, (job: Job) => this.run(job.name), { connection });
    this.worker.on("error", (error) => this.logger.error(`Mantenimiento: ${error.message}`));
    try {
      const template = { opts: { removeOnComplete: 10, removeOnFail: 50 } };
      // Los borrados, todos los días a las 03:00 y a las 03:10 (hora del servidor); el reintento, cada 5 minutos.
      await this.queue.upsertJobScheduler(
        "purge-expired-files",
        { pattern: "0 3 * * *" },
        { name: "purge-expired-files", ...template },
      );
      await this.queue.upsertJobScheduler(
        "purge-expired-conversations",
        { pattern: "10 3 * * *" },
        { name: "purge-expired-conversations", ...template },
      );
      await this.queue.upsertJobScheduler(
        "requeue-stalled-uploads",
        { every: 5 * 60 * 1000 },
        { name: "requeue-stalled-uploads", ...template },
      );
    } catch (error) {
      this.logger.error(`No se pudieron programar las tareas de mantenimiento: ${String(error)}`);
    }
  }

  private async run(name: string): Promise<number> {
    if (name === "purge-expired-files") return this.maintenance.purgeExpiredFiles();
    if (name === "purge-expired-conversations") {
      return this.conversations.purgeExpiredConversations();
    }
    if (name === "requeue-stalled-uploads") return this.maintenance.requeueStalledUploads();
    throw new Error(`Tarea de mantenimiento desconocida: ${name}`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.worker?.close(), this.queue?.close()]);
  }
}
