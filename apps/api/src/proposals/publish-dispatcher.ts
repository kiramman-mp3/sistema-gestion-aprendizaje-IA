import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue, Worker, type Job } from "bullmq";
import type { Env } from "../config/env";
import { bullConnection, PROPOSAL_PUBLISH_QUEUE } from "../queue/queue.constants";
import { ProposalPublisher } from "./proposal-publisher";

/**
 * Pone en marcha la publicación de una operación. La publicación puede tardar y no debe depender de la
 * petición HTTP (ADR-004); las pruebas la reemplazan por una que la ejecuta en el acto.
 */
export abstract class PublishDispatcher {
  /** Encola la operación; devuelve cuando quedó registrada, no cuando terminó. */
  abstract dispatch(operationId: string): Promise<void>;
}

/** Despachador real: cola de BullMQ con un worker en el propio backend. */
@Injectable()
export class QueuePublishDispatcher
  extends PublishDispatcher
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(QueuePublishDispatcher.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly publisher: ProposalPublisher,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  onModuleInit(): void {
    const redisUrl = this.config.get("REDIS_URL", { infer: true });
    if (!redisUrl) {
      this.logger.warn(
        "REDIS_URL no está definida; las publicaciones se ejecutan en el mismo proceso.",
      );
      return;
    }
    const connection = bullConnection(redisUrl);
    this.queue = new Queue(PROPOSAL_PUBLISH_QUEUE, { connection });
    // Una sola publicación a la vez por proceso: cada una hace muchas llamadas a Moodle.
    this.worker = new Worker(
      PROPOSAL_PUBLISH_QUEUE,
      (job: Job<{ operationId: string }>) => this.publisher.run(job.data.operationId),
      { connection, concurrency: 1 },
    );
    this.worker.on("error", (error) => this.logger.error(`Cola de publicación: ${error.message}`));
  }

  async dispatch(operationId: string): Promise<void> {
    if (!this.queue) {
      // Sin Redis no hay cola: se ejecuta en segundo plano para no bloquear la respuesta.
      void this.publisher.run(operationId).catch((error: unknown) => {
        this.logger.error(`Publicación ${operationId}: ${String(error)}`);
      });
      return;
    }
    await this.queue.add(
      "publish",
      { operationId },
      {
        // El id de la operación evita encolarla dos veces. Los reintentos son seguros: la publicación
        // es idempotente y una operación terminada no se vuelve a ejecutar.
        jobId: operationId,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.worker?.close(), this.queue?.close()]);
  }
}
