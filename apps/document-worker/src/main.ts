import { DOCUMENT_TEXT_QUEUE } from "@smart-lms/contracts";
import { Worker } from "bullmq";
import { loadConfig } from "./config.js";
import { processDocumentJob } from "./processor.js";

/**
 * Worker documental (ADR-003). No tiene acceso a la base de datos ni a Moodle: lee el archivo del
 * almacén compartido y devuelve el texto al backend por la cola (ADR-013).
 */
const config = loadConfig();
const log = (message: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), message, ...extra }));

const worker = new Worker(
  DOCUMENT_TEXT_QUEUE,
  (job) =>
    processDocumentJob(job.data, {
      storageDir: config.storageDir,
      onProgress: (percent) => job.updateProgress(percent),
    }),
  {
    connection: { url: config.redisUrl, maxRetriesPerRequest: null },
    concurrency: config.concurrency,
  },
);

// Solo ids y códigos: nunca el texto del documento.
worker.on("completed", (job) => log("Texto extraído", { jobId: job.id }));
worker.on("failed", (job, error) =>
  log("Extracción fallida", { jobId: job?.id, attempt: job?.attemptsMade, reason: error.message }),
);
worker.on("error", (error) => log("Error del worker", { reason: error.message }));
log("Worker documental listo", { queue: DOCUMENT_TEXT_QUEUE, concurrency: config.concurrency });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    // Termina los trabajos en curso antes de salir para no dejarlos bloqueados.
    void worker.close().then(() => process.exit(0));
  });
}
