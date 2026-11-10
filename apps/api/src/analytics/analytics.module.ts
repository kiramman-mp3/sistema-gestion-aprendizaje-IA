import { Module } from "@nestjs/common";
import { MoodleModule } from "../integrations/moodle/moodle.module";
import { MappingsModule } from "../mappings/mappings.module";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsDataService } from "./analytics-data.service";
import { AnalyticsService } from "./analytics.service";
import { SnapshotsService } from "./snapshots.service";

@Module({
  imports: [MoodleModule, MappingsModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsDataService, AnalyticsService, SnapshotsService],
  exports: [AnalyticsService, AnalyticsDataService, SnapshotsService],
})
export class AnalyticsModule {}
