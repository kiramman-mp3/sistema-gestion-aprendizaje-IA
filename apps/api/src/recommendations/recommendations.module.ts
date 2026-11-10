import { Module } from "@nestjs/common";
import { FollowupsService } from "./followups.service";
import { RecommendationsController } from "./recommendations.controller";

@Module({
  controllers: [RecommendationsController],
  providers: [FollowupsService],
})
export class RecommendationsModule {}
