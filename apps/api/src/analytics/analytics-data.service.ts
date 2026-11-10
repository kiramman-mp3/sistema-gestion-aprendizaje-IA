import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import type { Submission } from "@smart-lms/contracts";
import type { AuthContext } from "../auth/auth-context";
import { MoodleRead } from "../integrations/moodle/moodle-read.service";
import { MappingsService } from "../mappings/mappings.service";
import type { AnalyticsDataset } from "./analytics.types";

/** Tareas vencidas de las que se leen las entregas; una por llamada a Moodle. */
export const MAX_SUBMISSION_READS = 50;
const READ_CONCURRENCY = 5;

/**
 * Reúne los datos de un curso para la analítica. Las lecturas esenciales (actividades y estudiantes) deben
 * funcionar o la petición responde 503. Las demás, si fallan o vienen recortadas (`truncated`), dejan sus
 * indicadores sin valor: unos porcentajes calculados sobre una lista parcial serían falsos, y es mejor
 * mostrar un guion que un número equivocado.
 */
@Injectable()
export class AnalyticsDataService {
  private readonly logger = new Logger(AnalyticsDataService.name);

  constructor(
    private readonly moodle: MoodleRead,
    private readonly mappings: MappingsService,
  ) {}

  async load(auth: AuthContext, now = new Date()): Promise<AnalyticsDataset> {
    const { moodleUserId: userId, courseId } = auth;

    const [activities, students] = await Promise.all([
      this.moodle.listActivities(userId, courseId),
      this.moodle.listStudents(userId, courseId),
    ]).catch((error: unknown) => {
      this.logger.error(
        `Analítica: no se pudieron leer las actividades o los estudiantes (${String(error)}).`,
      );
      throw new ServiceUnavailableException({
        code: "MOODLE_UNAVAILABLE",
        message:
          "No se pudieron leer los datos del curso en Moodle. Inténtalo de nuevo en unos minutos.",
      });
    });

    const overview = await this.mappings.overview(auth);
    const base = {
      now,
      mappings: overview.mappings.map((m) => ({
        cmid: m.moodleCmId,
        unitRef: m.unitRef,
        learningOutcomeIds: m.learningOutcomeIds,
      })),
      units: overview.units.map((u) => ({ unitRef: u.unitRef, title: u.title })),
    };

    // Con la lista de estudiantes o de actividades recortada, cualquier porcentaje sería parcial.
    if (activities.truncated || students.truncated) {
      this.logger.warn(
        `Analítica del curso ${courseId}: Moodle recortó la lista; los indicadores quedan sin valor.`,
      );
      return {
        ...base,
        activities: [],
        studentIds: [],
        submissions: null,
        pending: null,
        grades: null,
        completion: null,
        lastAccess: null,
      };
    }

    const studentIds = students.students.map((s) => s.studentid);
    const [pending, grades, completion, lastAccess, submissions] = await Promise.all([
      this.optional(
        "entregas pendientes",
        () => this.moodle.getPendingGrading(userId, courseId),
        (r) => r.pending,
      ),
      this.optional(
        "notas",
        () => this.moodle.getGrades(userId, courseId),
        (r) => r.grades,
      ),
      this.optional(
        "finalización",
        () => this.moodle.getCompletion(userId, courseId),
        (r) => r.completion,
      ),
      this.optional(
        "accesos",
        () => this.moodle.getLastAccess(userId, courseId),
        (r) => r.lastaccess,
      ),
      this.readSubmissions(auth, activities.activities, now),
    ]);

    return {
      ...base,
      activities: activities.activities,
      studentIds,
      submissions,
      pending,
      grades,
      completion,
      lastAccess,
    };
  }

  /** Una lectura no esencial: `null` si falla o viene recortada. */
  private async optional<R extends { truncated: boolean }, T>(
    what: string,
    read: () => Promise<R>,
    pick: (result: R) => T,
  ): Promise<T | null> {
    try {
      const result = await read();
      if (result.truncated) {
        this.logger.warn(`Analítica: Moodle recortó la lista de ${what}; se ignora.`);
        return null;
      }
      return pick(result);
    } catch (error) {
      this.logger.warn(`Analítica: no se pudieron leer las ${what} (${(error as Error).name}).`);
      return null;
    }
  }

  /** Entregas de las tareas visibles ya vencidas. Si falla alguna, se descartan todas: un conteo parcial engaña. */
  private async readSubmissions(
    auth: AuthContext,
    activities: AnalyticsDataset["activities"],
    now: Date,
  ): Promise<Map<number, Submission[]> | null> {
    const due = activities.filter(
      (a) =>
        a.modname === "assign" &&
        a.visible &&
        a.duedate !== null &&
        new Date(a.duedate).getTime() < now.getTime(),
    );
    if (due.length > MAX_SUBMISSION_READS) {
      this.logger.warn(
        `Analítica: ${due.length} tareas vencidas superan el máximo de ${MAX_SUBMISSION_READS}.`,
      );
      return null;
    }

    const result = new Map<number, Submission[]>();
    try {
      for (let i = 0; i < due.length; i += READ_CONCURRENCY) {
        const batch = due.slice(i, i + READ_CONCURRENCY);
        const responses = await Promise.all(
          batch.map((a) => this.moodle.getSubmissions(auth.moodleUserId, auth.courseId, a.cmid)),
        );
        responses.forEach((response, index) => {
          if (response.truncated) throw new Error("recortada");
          result.set(batch[index]!.cmid, response.submissions);
        });
      }
    } catch (error) {
      this.logger.warn(
        `Analítica: no se pudieron leer las entregas (${(error as Error).message}).`,
      );
      return null;
    }
    return result;
  }
}
