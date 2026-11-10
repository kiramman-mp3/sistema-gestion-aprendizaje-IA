import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module";
import { SyllabiModule } from "../syllabi/syllabi.module";
import { ConversationMaintenanceService } from "./conversation-maintenance.service";
import { MaintenanceWorker } from "./maintenance.worker";
import { SyllabusMaintenanceService } from "./syllabus-maintenance.service";

@Module({
  imports: [SyllabiModule, AnalyticsModule],
  providers: [SyllabusMaintenanceService, ConversationMaintenanceService, MaintenanceWorker],
})
export class MaintenanceModule {}
