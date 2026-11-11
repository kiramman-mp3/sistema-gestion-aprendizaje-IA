import { Body, Controller, Param, Post } from "@nestjs/common";
import { Auth, type AuthContext } from "../auth/auth-context";
import { RequireCapability } from "../auth/require-capability.decorator";
import { FollowupsService, type FollowupDto } from "./followups.service";

@Controller("recommendations")
export class RecommendationsController {
  constructor(private readonly followups: FollowupsService) {}

  /** Registra el seguimiento docente de una recomendación (RF-20). Exige `viewanalytics`, como la propia analítica. */
  @Post(":recommendationId/followups")
  @RequireCapability("viewanalytics")
  addFollowup(
    @Auth() auth: AuthContext,
    @Param("recommendationId") recommendationId: string,
    @Body() body: unknown,
  ): Promise<FollowupDto> {
    return this.followups.add(auth, recommendationId, body);
  }
}
