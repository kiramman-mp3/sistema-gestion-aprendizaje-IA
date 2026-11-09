import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";

/** Forma de error del contrato OpenAPI (`components/schemas/Error`). */
export interface ApiError {
  code: string;
  message: string;
  details?: { path: string; message: string }[];
}

const DEFAULT_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: "VALIDATION_ERROR",
  [HttpStatus.UNAUTHORIZED]: "UNAUTHORIZED",
  [HttpStatus.FORBIDDEN]: "FORBIDDEN",
  [HttpStatus.NOT_FOUND]: "NOT_FOUND",
  [HttpStatus.CONFLICT]: "CONFLICT",
  [HttpStatus.PAYLOAD_TOO_LARGE]: "PAYLOAD_TOO_LARGE",
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: "UNSUPPORTED_MEDIA_TYPE",
  [HttpStatus.TOO_MANY_REQUESTS]: "RATE_LIMITED",
  [HttpStatus.SERVICE_UNAVAILABLE]: "SERVICE_UNAVAILABLE",
};

/**
 * Convierte cualquier excepción en la forma de error del contrato. Los errores no controlados se
 * registran completos en el log y se devuelven como `INTERNAL_ERROR` sin detalles internos.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json(toApiError(status, exception.getResponse()));
      return;
    }

    this.logger.error(exception);
    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ code: "INTERNAL_ERROR", message: "Error interno del servidor." } satisfies ApiError);
  }
}

function toApiError(status: number, body: string | object): ApiError {
  const code = DEFAULT_CODES[status] ?? `HTTP_${status}`;
  if (typeof body === "string") return { code, message: body };

  const candidate = body as Record<string, unknown>;
  const message = candidate.message;
  return {
    code: typeof candidate.code === "string" ? candidate.code : code,
    message:
      typeof message === "string"
        ? message
        : Array.isArray(message)
          ? message.join("; ")
          : "Error en la petición.",
    ...(Array.isArray(candidate.details)
      ? { details: candidate.details as NonNullable<ApiError["details"]> }
      : {}),
  };
}
