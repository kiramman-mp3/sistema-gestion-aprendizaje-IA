import { Controller, Get, NotFoundException, Param, Query } from "@nestjs/common";
import { Auth, type AuthContext } from "../auth/auth-context";
import { RequireCapability } from "../auth/require-capability.decorator";
import {
  AnalyticsService,
  type CourseAnalyticsDto,
  type StudentEvidenceDto,
} from "./analytics.service";
import { SnapshotsService, type AnalyticsHistoryDto } from "./snapshots.service";

/**
 * Analítica del curso (Sprints 10 y 11). Exige `viewanalytics`. El `:courseId` de la ruta debe ser el del
 * token: `CourseAccessGuard` lo comprueba antes de llegar aquí.
 */
@Controller("analytics/courses/:courseId")
@RequireCapability("viewanalytics")
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly snapshots: SnapshotsService,
  ) {}

  @Get()
  course(@Auth() auth: AuthContext): Promise<CourseAnalyticsDto> {
    return this.analytics.courseAnalytics(auth);
  }

  /** Evolución de los indicadores: los snapshots que dejó el propio docente al abrir el panel (ADR-018). */
  @Get("history")
  history(@Auth() auth: AuthContext, @Query() query: unknown): Promise<AnalyticsHistoryDto> {
    return this.snapshots.history(auth, query);
  }

  @Get("students/:studentId")
  student(
    @Auth() auth: AuthContext,
    @Param("studentId") studentId: string,
  ): Promise<StudentEvidenceDto> {
    // Un id que no es un entero positivo se trata como un estudiante que no existe.
    if (!/^[1-9]\d{0,9}$/.test(studentId)) {
      throw new NotFoundException({
        code: "STUDENT_NOT_FOUND",
        message: "El estudiante no está en el curso.",
      });
    }
    return this.analytics.studentEvidence(auth, Number(studentId));
  }
}
