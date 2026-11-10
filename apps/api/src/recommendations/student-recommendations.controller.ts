import { Controller, NotFoundException, Param, Post } from "@nestjs/common";
import { Auth, type AuthContext } from "../auth/auth-context";
import { RequireCapability } from "../auth/require-capability.decorator";
import { RecommendationsService, type RecommendationDto } from "./recommendations.service";

/** Recomendaciones pedagógicas de un estudiante (RF-18). Exige `viewanalytics`. */
@Controller("analytics/courses/:courseId/students/:studentId/recommendations")
@RequireCapability("viewanalytics")
export class StudentRecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Post()
  create(
    @Auth() auth: AuthContext,
    @Param("studentId") studentId: string,
  ): Promise<RecommendationDto> {
    if (!/^[1-9]\d{0,9}$/.test(studentId)) {
      throw new NotFoundException({
        code: "STUDENT_NOT_FOUND",
        message: "El estudiante no está en el curso.",
      });
    }
    return this.recommendations.generate(auth, Number(studentId));
  }
}
