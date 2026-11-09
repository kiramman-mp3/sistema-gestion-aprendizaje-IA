import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "auth:isPublic";

/** Marca una ruta como pública. Todas las demás exigen el token del plugin. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
