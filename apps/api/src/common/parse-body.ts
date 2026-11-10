import { BadRequestException } from "@nestjs/common";
import type { z } from "zod";

/**
 * Valida el cuerpo de una petición con un esquema Zod. Si no cumple, responde 400 con el formato de
 * error del contrato: `details` lista la ruta de cada campo inválido.
 */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;

  throw new BadRequestException({
    code: "VALIDATION_ERROR",
    message: "La petición no cumple el formato esperado.",
    details: result.error.issues.map((issue) => ({
      path: issue.path.join(".") || "body",
      message: issue.message,
    })),
  });
}
