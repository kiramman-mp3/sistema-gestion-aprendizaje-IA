import { Injectable } from "@nestjs/common";
import type { HealthIndicator } from "../../health/health-indicator";
import { MoodleClient } from "./moodle.client";
import {
  courseAccessSchema,
  siteInfoSchema,
  type CourseAccess,
  type SiteInfo,
} from "./moodle.types";

/**
 * Operaciones de Moodle que usa el backend. Cada método nombra una función del servicio web y valida
 * su respuesta; las herramientas académicas (S8) se construyen sobre este servicio.
 */
@Injectable()
export class MoodleService implements HealthIndicator {
  readonly name = "moodle";

  constructor(private readonly client: MoodleClient) {}

  getSiteInfo(): Promise<SiteInfo> {
    return this.client.call("core_webservice_get_site_info", {}, siteInfoSchema, {
      readOnly: true,
    });
  }

  /** Capacidades del asistente de un usuario en un curso, según Moodle. */
  checkAccess(moodleUserId: number, courseId: number): Promise<CourseAccess> {
    return this.client.call(
      "local_ai_assistant_check_access",
      { userid: moodleUserId, courseid: courseId },
      courseAccessSchema,
      { readOnly: true },
    );
  }

  async isHealthy(): Promise<boolean> {
    await this.getSiteInfo();
    return true;
  }
}
