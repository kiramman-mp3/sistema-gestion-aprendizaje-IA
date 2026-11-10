import { Module } from "@nestjs/common";
import { AntivirusModule } from "../antivirus/antivirus.module";
import { DocumentTextResultsHandler } from "./document-text-results.handler";
import { DocumentTextResultsWorker } from "./document-text-results.worker";
import { SyllabusExtractorService } from "./extraction/syllabus-extractor.service";
import { SyllabiController } from "./syllabi.controller";
import { SyllabiService } from "./syllabi.service";
import { SyllabusProcessingService } from "./syllabus-processing.service";

@Module({
  imports: [AntivirusModule],
  controllers: [SyllabiController],
  providers: [
    SyllabiService,
    SyllabusProcessingService,
    SyllabusExtractorService,
    DocumentTextResultsHandler,
    DocumentTextResultsWorker,
  ],
  exports: [SyllabusProcessingService, SyllabusExtractorService],
})
export class SyllabiModule {}
