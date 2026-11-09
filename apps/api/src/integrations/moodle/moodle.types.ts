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
