import { Module } from "@nestjs/common";
import { AnalyticsDataService } from "../analytics/analytics-data.service";
import { AnalyticsModule } from "../analytics/analytics.module";
import { MoodleModule } from "../integrations/moodle/moodle.module";
import { MoodleRead } from "../integrations/moodle/moodle-read.service";
import { PseudonymizerFactory } from "../privacy/pseudonymizer.factory";
import { ChunkSearchService } from "../rag/chunk-search.service";
import { RagModule } from "../rag/rag.module";
import { AiOrchestratorService } from "./ai-orchestrator.service";
import { AssistantController } from "./assistant.controller";
import { ChatService } from "./chat.service";
import { ASSISTANT_TOOLS, ToolRegistry, type AssistantTool } from "./tools/assistant-tool";
import { SearchCourseDocumentsTool } from "./tools/document-tools";
import {
  GetAssignmentSubmissionsTool,
  GetCourseActivitiesTool,
  GetGradeSummaryTool,
  GetPendingGradingTool,
  GetUnitPerformanceTool,
} from "./tools/moodle-tools";
import { UsageQuotaService } from "./usage-quota.service";

@Module({
  imports: [MoodleModule, AnalyticsModule, RagModule],
  controllers: [AssistantController],
  providers: [
    {
      provide: ASSISTANT_TOOLS,
      inject: [MoodleRead, AnalyticsDataService, ChunkSearchService],
      useFactory: (
        moodle: MoodleRead,
        analytics: AnalyticsDataService,
        search: ChunkSearchService,
      ): AssistantTool[] => [
        new GetCourseActivitiesTool(moodle),
        new GetAssignmentSubmissionsTool(moodle),
        new GetPendingGradingTool(moodle),
        new GetGradeSummaryTool(moodle),
        new GetUnitPerformanceTool(analytics),
        new SearchCourseDocumentsTool(search),
      ],
    },
    {
      provide: ToolRegistry,
      inject: [ASSISTANT_TOOLS],
      useFactory: (tools: AssistantTool[]) => new ToolRegistry(tools),
    },
    PseudonymizerFactory,
    UsageQuotaService,
    AiOrchestratorService,
    ChatService,
  ],
  exports: [ToolRegistry],
})
export class AssistantModule {}
