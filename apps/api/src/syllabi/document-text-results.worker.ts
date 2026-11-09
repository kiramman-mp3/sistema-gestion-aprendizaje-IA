import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Worker, type Job } from "bullmq";
import type { Env } from "../config/env";
import { bullConnection, DOCUMENT_TEXT_RESULTS_QUEUE } from "../queue/queue.constants";
import { DocumentTextResultsHandler } from "./document-text-results.handler";

/** Procesa en el backend los trabajos padre del flujo de extracción (ver `queue.constants.ts`). */
@Injectable()
export class DocumentTextResultsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DocumentTextResultsWorker.name);
  private worker?: Worker;

  constructor(
    private readonly handler: DocumentTextResultsHandler,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    const redisUrl = this.config.get("REDIS_URL", { infer: true });
    if (!redisUrl) return;
    this.worker = new Worker(DOCUMENT_TEXT_RESULTS_QUEUE, (job: Job) => this.process(job), {
      connection: bullConnection(redisUrl),
      concurrency: 5,
    });
    this.worker.on("error", (error) => this.logger.error(`Cola de resultados: ${error.message}`));
  }

  private async process(job: Job<{ documentId: string }>): Promise<void> {
    const values = Object.values(await job.getChildrenValues());
    const failures = Object.values(await job.getIgnoredChildrenFailures());
    await this.handler.handle(job.data.documentId, {
      value: values[0],
      failedReason: failures[0],
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
