import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module";
import { FollowupsService } from "./followups.service";
import { RecommendationsController } from "./recommendations.controller";
import { RecommendationsService } from "./recommendations.service";
import { StudentRecommendationsController } from "./student-recommendations.controller";

@Module({
  imports: [AnalyticsModule],
  controllers: [RecommendationsController, StudentRecommendationsController],
  providers: [FollowupsService, RecommendationsService],
})
export class RecommendationsModule {}
