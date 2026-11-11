import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AuditAdminService } from "./audit-admin.service";
import { DifficultyRulesAdminService } from "./difficulty-rules-admin.service";

@Module({
  controllers: [AdminController],
  providers: [AuditAdminService, DifficultyRulesAdminService],
})
export class AdminModule {}
