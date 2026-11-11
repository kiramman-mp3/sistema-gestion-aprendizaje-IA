import { Injectable } from "@nestjs/common";
import type { HealthIndicator } from "../../health/health-indicator";
import { MoodleClient } from "./moodle.client";
import {
  courseAccessSchema,
  publishedModuleSchema,
  publishedSectionSchema,
  siteInfoSchema,
  type CourseAccess,
  type PublishedModule,
  type PublishedSection,
  type PublishModuleInput,
  type PublishSectionInput,
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

  /**
   * Crea (o reconoce) la sección de un elemento de la propuesta. No es de solo lectura: el cliente no la
   * reintenta, porque un timeout pudo haberla aplicado. La repetición es segura de todos modos, porque
   * Moodle responde con la sección que ya creó para ese `itemId` (RF-09).
   */
  publishSection(input: PublishSectionInput): Promise<PublishedSection> {
    return this.client.call(
      "local_ai_assistant_publish_section",
      {
        userid: input.userId,
        courseid: input.courseId,
        itemid: input.itemId,
        name: input.name,
        summary: input.summary ?? "",
      },
      publishedSectionSchema,
      { readOnly: false },
    );
  }

  /** Crea (o reconoce) el módulo de un elemento de la propuesta dentro de una sección. */
  publishModule(input: PublishModuleInput): Promise<PublishedModule> {
    return this.client.call(
      "local_ai_assistant_publish_module",
      {
        userid: input.userId,
        courseid: input.courseId,
        itemid: input.itemId,
        sectionid: input.sectionId,
        modname: input.module,
        name: input.name,
        intro: input.intro ?? "",
        duedate: input.dueDate ?? "",
      },
      publishedModuleSchema,
      { readOnly: false },
    );
  }

  async isHealthy(): Promise<boolean> {
    await this.getSiteInfo();
    return true;
  }
}
