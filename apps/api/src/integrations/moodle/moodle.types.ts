import { z } from "zod";

/** Subconjunto de `core_webservice_get_site_info` que usa el backend. */
export const siteInfoSchema = z.object({
  sitename: z.string(),
  userid: z.number().int(),
  release: z.string(),
  version: z.string(),
  functions: z.array(z.object({ name: z.string() })).default([]),
});

export type SiteInfo = z.infer<typeof siteInfoSchema>;

/** Respuesta de `local_ai_assistant_check_access` (ADR-007). */
export const courseAccessSchema = z.object({
  userid: z.number().int(),
  courseid: z.number().int(),
  courseexists: z.boolean(),
  active: z.boolean(),
  roles: z.array(z.string()),
  capabilities: z.object({
    use: z.boolean(),
    publish: z.boolean(),
    viewanalytics: z.boolean(),
  }),
});

export type CourseAccess = z.infer<typeof courseAccessSchema>;

/** Módulos de Moodle que el plugin sabe crear (D-05). */
export const PUBLISHABLE_MODULES = ["assign", "forum", "quiz", "label", "page"] as const;
export type PublishableModule = (typeof PUBLISHABLE_MODULES)[number];

/** Respuesta de `local_ai_assistant_publish_section`. */
export const publishedSectionSchema = z.object({
  sectionid: z.number().int(),
  sectionnum: z.number().int(),
  /** `false` si la sección ya existía: es una repetición de la misma publicación. */
  created: z.boolean(),
});
export type PublishedSection = z.infer<typeof publishedSectionSchema>;

/** Respuesta de `local_ai_assistant_publish_module`. */
export const publishedModuleSchema = z.object({
  cmid: z.number().int(),
  created: z.boolean(),
});
export type PublishedModule = z.infer<typeof publishedModuleSchema>;

export interface PublishSectionInput {
  /** Docente en cuyo nombre se publica; Moodle valida sus permisos. */
  userId: number;
  courseId: number;
  /** Id del elemento de la propuesta; con él Moodle reconoce una repetición. */
  itemId: string;
  name: string;
  summary: string | null;
}

export interface PublishModuleInput {
  userId: number;
  courseId: number;
  itemId: string;
  /** Id de la sección de Moodle donde se crea el módulo. */
  sectionId: number;
  module: PublishableModule;
  name: string;
  intro: string | null;
  /** `AAAA-MM-DD`, o `null` si no hay fecha. */
  dueDate: string | null;
}
