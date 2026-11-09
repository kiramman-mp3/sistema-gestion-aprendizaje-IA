import { Module } from "@nestjs/common";
import { AntivirusModule } from "../antivirus/antivirus.module";
import { SyllabiController } from "./syllabi.controller";
import { SyllabiService } from "./syllabi.service";

@Module({
  imports: [AntivirusModule],
  controllers: [SyllabiController],
  providers: [SyllabiService],
})
export class SyllabiModule {}
