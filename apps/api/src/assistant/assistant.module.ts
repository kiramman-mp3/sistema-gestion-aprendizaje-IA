import { Module } from "@nestjs/common";
import { MoodleModule } from "../integrations/moodle/moodle.module";
import { MoodleRead } from "../integrations/moodle/moodle-read.service";
import { PseudonymizerFactory } from "../privacy/pseudonymizer.factory";
import { AiOrchestratorService } from "./ai-orchestrator.service";
import { AssistantController } from "./assistant.controller";
import { ChatService } from "./chat.service";
import { ASSISTANT_TOOLS, ToolRegistry, type AssistantTool } from "./tools/assistant-tool";
import {
  GetAssignmentSubmissionsTool,
  GetCourseActivitiesTool,
  GetGradeSummaryTool,
  GetPendingGradingTool,
} from "./tools/moodle-tools";
import { UsageQuotaService } from "./usage-quota.service";

@Module({
  imports: [MoodleModule],
  controllers: [AssistantController],
  providers: [
    {
      provide: ASSISTANT_TOOLS,
      inject: [MoodleRead],
      useFactory: (moodle: MoodleRead): AssistantTool[] => [
        new GetCourseActivitiesTool(moodle),
        new GetAssignmentSubmissionsTool(moodle),
        new GetPendingGradingTool(moodle),
        new GetGradeSummaryTool(moodle),
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
