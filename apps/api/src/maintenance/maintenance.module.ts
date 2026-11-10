import { Module } from "@nestjs/common";
import { SyllabiModule } from "../syllabi/syllabi.module";
import { ConversationMaintenanceService } from "./conversation-maintenance.service";
import { MaintenanceWorker } from "./maintenance.worker";
import { SyllabusMaintenanceService } from "./syllabus-maintenance.service";

@Module({
  imports: [SyllabiModule],
  providers: [SyllabusMaintenanceService, ConversationMaintenanceService, MaintenanceWorker],
})
export class MaintenanceModule {}
