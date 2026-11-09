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
