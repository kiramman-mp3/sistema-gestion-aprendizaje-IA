import { Module } from "@nestjs/common";
import { SyllabiModule } from "../syllabi/syllabi.module";
import { MaintenanceWorker } from "./maintenance.worker";
import { SyllabusMaintenanceService } from "./syllabus-maintenance.service";

@Module({
  imports: [SyllabiModule],
  providers: [SyllabusMaintenanceService, MaintenanceWorker],
})
export class MaintenanceModule {}
