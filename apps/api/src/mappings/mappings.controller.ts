import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from "@nestjs/common";
import { Auth, type AuthContext } from "../auth/auth-context";
import { RequireCapability } from "../auth/require-capability.decorator";
import type { MappingDto, MappingOverviewDto } from "./mapping.dto";
import { MappingsService } from "./mappings.service";

/**
 * Relación de las actividades del curso con las unidades del sílabo (Sprint 9). El `:courseId` de la ruta
 * debe ser el del token; `CourseAccessGuard` lo comprueba antes de llegar aquí. Cambiarla exige `publish`:
 * decide a qué unidad cuenta cada actividad en los indicadores.
 */
@Controller("courses/:courseId/activity-mappings")
export class MappingsController {
  constructor(private readonly mappings: MappingsService) {}

  @Get()
  overview(@Auth() auth: AuthContext): Promise<MappingOverviewDto> {
    return this.mappings.overview(auth);
  }

  @Put(":cmId")
  @RequireCapability("publish")
  save(
    @Auth() auth: AuthContext,
    @Param("cmId") cmId: string,
    @Body() body: unknown,
  ): Promise<MappingDto> {
    return this.mappings.save(auth, cmId, body);
  }

  @Delete(":cmId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireCapability("publish")
  remove(@Auth() auth: AuthContext, @Param("cmId") cmId: string): Promise<void> {
    return this.mappings.remove(auth, cmId);
  }
}
