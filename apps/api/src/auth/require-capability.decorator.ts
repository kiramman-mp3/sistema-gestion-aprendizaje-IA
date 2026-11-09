import { SetMetadata } from "@nestjs/common";

/** Capacidades del asistente. `use` se exige siempre; las demás se piden por ruta. */
export type AssistantCapability = "use" | "publish" | "viewanalytics";

export const REQUIRED_CAPABILITIES = "auth:requiredCapabilities";

/** Exige capacidades adicionales a `use` en el curso del token. */
export const RequireCapability = (
  ...capabilities: Exclude<AssistantCapability, "use">[]
): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_CAPABILITIES, capabilities);
