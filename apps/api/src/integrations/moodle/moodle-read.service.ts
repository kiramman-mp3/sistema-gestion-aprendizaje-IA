import { Injectable } from "@nestjs/common";
import {
  getCompletionResponseSchema,
  getGradesResponseSchema,
  getLastAccessResponseSchema,
  getPendingGradingResponseSchema,
  getSubmissionsResponseSchema,
  listActivitiesResponseSchema,
  listStudentsResponseSchema,
  MOODLE_READ_FUNCTIONS as FN,
} from "@smart-lms/contracts";
import type { z } from "zod";
import { MoodleClient } from "./moodle.client";

type Parsed<S extends z.ZodType> = z.infer<S>;

/**
 * Lecturas de datos académicos que usan las herramientas del asistente (Sprint 8). Es el contrato que el
 * código de la aplicación conoce: las herramientas no saben cómo se llama a Moodle, y las pruebas lo
 * sustituyen con datos en memoria.
 *
 * Todas las lecturas se hacen en nombre del docente (`userId`) y solo devuelven ids de Moodle, nunca
 * nombres ni datos personales (ADR-010).
 */
export abstract class MoodleRead {
  abstract listActivities(
    userId: number,
    courseId: number,
  ): Promise<Parsed<typeof listActivitiesResponseSchema>>;
  abstract listStudents(
    userId: number,
    courseId: number,
  ): Promise<Parsed<typeof listStudentsResponseSchema>>;
  abstract getSubmissions(
    userId: number,
    courseId: number,
    cmid: number,
  ): Promise<Parsed<typeof getSubmissionsResponseSchema>>;
  abstract getPendingGrading(
    userId: number,
    courseId: number,
    cmid?: number,
  ): Promise<Parsed<typeof getPendingGradingResponseSchema>>;
  abstract getGrades(
    userId: number,
    courseId: number,
    cmid?: number,
  ): Promise<Parsed<typeof getGradesResponseSchema>>;
  abstract getCompletion(
    userId: number,
    courseId: number,
  ): Promise<Parsed<typeof getCompletionResponseSchema>>;
  abstract getLastAccess(
    userId: number,
    courseId: number,
  ): Promise<Parsed<typeof getLastAccessResponseSchema>>;
}

/**
 * Implementación contra el servicio web del plugin. Cada respuesta se valida con el esquema de
 * `@smart-lms/contracts`: si Moodle devuelve un campo de más (por ejemplo un nombre), la validación
 * falla y el dato no llega al modelo. Son lecturas, así que el cliente puede reintentarlas.
 */
@Injectable()
export class MoodleReadService extends MoodleRead {
  constructor(private readonly client: MoodleClient) {
    super();
  }

  listActivities(userId: number, courseId: number) {
    return this.read(FN.listActivities, userId, courseId, listActivitiesResponseSchema);
  }

  listStudents(userId: number, courseId: number) {
    return this.read(FN.listStudents, userId, courseId, listStudentsResponseSchema);
  }

  getSubmissions(userId: number, courseId: number, cmid: number) {
    return this.read(FN.getSubmissions, userId, courseId, getSubmissionsResponseSchema, { cmid });
  }

  getPendingGrading(userId: number, courseId: number, cmid?: number) {
    return this.read(
      FN.getPendingGrading,
      userId,
      courseId,
      getPendingGradingResponseSchema,
      cmid === undefined ? {} : { cmid },
    );
  }

  getGrades(userId: number, courseId: number, cmid?: number) {
    return this.read(
      FN.getGrades,
      userId,
      courseId,
      getGradesResponseSchema,
      cmid === undefined ? {} : { cmid },
    );
  }

  getCompletion(userId: number, courseId: number) {
    return this.read(FN.getCompletion, userId, courseId, getCompletionResponseSchema);
  }

  getLastAccess(userId: number, courseId: number) {
    return this.read(FN.getLastAccess, userId, courseId, getLastAccessResponseSchema);
  }

  private read<S extends z.ZodType>(
    wsfunction: string,
    userId: number,
    courseId: number,
    schema: S,
    extra: Record<string, number> = {},
  ): Promise<Parsed<S>> {
    return this.client.call(wsfunction, { userid: userId, courseid: courseId, ...extra }, schema, {
      readOnly: true,
    });
  }
}
