export { DOCUMENT_TEXT_QUEUE } from "@smart-lms/contracts";

/**
 * Cola del backend que guarda en PostgreSQL el resultado del worker documental. Cada trabajo es el
 * padre de un trabajo de `document-text` (flujo de BullMQ): se procesa cuando el hijo termina, con
 * éxito o tras agotar sus reintentos. Así el worker no necesita acceso a la base (ADR-013).
 */
export const DOCUMENT_TEXT_RESULTS_QUEUE = "document-text-results";

/** Opciones de conexión de BullMQ a partir de `REDIS_URL`. */
export function bullConnection(redisUrl: string) {
  // Los workers de BullMQ exigen reintentos ilimitados por comando: esperan bloqueados en Redis.
  return { url: redisUrl, maxRetriesPerRequest: null };
}
