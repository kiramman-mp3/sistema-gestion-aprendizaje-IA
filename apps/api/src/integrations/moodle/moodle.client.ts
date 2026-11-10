import type { z } from "zod";
import { MoodleResponseError, MoodleUnavailableError, toMoodleApiError } from "./moodle.errors";
import { encodeMoodleParams, type MoodleParamValue } from "./moodle.params";

export interface MoodleClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  /** Reintentos adicionales para operaciones de solo lectura ante fallos de red o 5xx. */
  maxRetries?: number;
  retryBaseDelayMs?: number;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface MoodleCallOptions {
  /**
   * Solo las operaciones de lectura se reintentan. Una escritura que falla por timeout pudo haberse
   * aplicado en Moodle; reintentarla podría duplicar elementos (RF-09).
   */
  readOnly: boolean;
}

/** Relativa para respetar instalaciones de Moodle en un subdirectorio (`https://host/moodle/`). */
const REST_PATH = "webservice/rest/server.php";

/**
 * Cliente del protocolo REST de servicios web de Moodle. Usa el token del usuario de integración, que
 * tiene permisos mínimos; la autorización del docente se valida aparte (ADR-007).
 */
export class MoodleClient {
  private readonly endpoint: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;

  constructor(private readonly options: MoodleClientOptions) {
    this.endpoint = new URL(REST_PATH, ensureTrailingSlash(options.baseUrl)).toString();
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = options.maxRetries ?? 2;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 300;
  }

  async call<S extends z.ZodType>(
    wsfunction: string,
    params: Record<string, MoodleParamValue>,
    schema: S,
    { readOnly }: MoodleCallOptions,
  ): Promise<z.infer<S>> {
    const attempts = readOnly ? this.maxRetries + 1 : 1;

    for (let attempt = 1; ; attempt++) {
      try {
        const raw = await this.request(wsfunction, params);
        return this.parse(wsfunction, raw, schema);
      } catch (error) {
        const retryable = error instanceof MoodleUnavailableError && attempt < attempts;
        if (!retryable) throw error;
        await this.sleep(this.retryBaseDelayMs * 2 ** (attempt - 1));
      }
    }
  }

  private async request(
    wsfunction: string,
    params: Record<string, MoodleParamValue>,
  ): Promise<unknown> {
    const body = encodeMoodleParams({
      ...params,
      wstoken: this.options.token,
      wsfunction,
      moodlewsrestformat: "json",
    });

    let response: Response;
    try {
      response = await this.fetchFn(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "red";
      throw new MoodleUnavailableError(`Moodle no disponible (${reason}).`, wsfunction);
    }

    if (response.status >= 500) {
      throw new MoodleUnavailableError(`Moodle respondió ${response.status}.`, wsfunction);
    }
    if (!response.ok) {
      throw new MoodleResponseError(`Moodle respondió ${response.status}.`, wsfunction);
    }

    try {
      return await response.json();
    } catch {
      throw new MoodleResponseError("Moodle no devolvió JSON válido.", wsfunction);
    }
  }

  private parse<S extends z.ZodType>(wsfunction: string, raw: unknown, schema: S): z.infer<S> {
    if (isMoodleException(raw)) {
      throw toMoodleApiError(wsfunction, raw.errorcode, raw.message);
    }
    const result = schema.safeParse(raw);
    if (!result.success) {
      throw new MoodleResponseError(
        `Respuesta inesperada: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}`,
        wsfunction,
      );
    }
    return result.data;
  }
}

function isMoodleException(
  raw: unknown,
): raw is { exception: string; errorcode: string; message: string } {
  return (
    typeof raw === "object" &&
    raw !== null &&
    "exception" in raw &&
    typeof (raw as { errorcode?: unknown }).errorcode === "string"
  );
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}
