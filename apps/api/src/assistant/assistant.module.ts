import { Module } from "@nestjs/common";
import { PseudonymizerFactory } from "../privacy/pseudonymizer.factory";
import { AiOrchestratorService } from "./ai-orchestrator.service";
import { AssistantController } from "./assistant.controller";
import { ChatService } from "./chat.service";
import { ASSISTANT_TOOLS, ToolRegistry, type AssistantTool } from "./tools/assistant-tool";
import { UsageQuotaService } from "./usage-quota.service";

@Module({
  controllers: [AssistantController],
  providers: [
    // Las herramientas de lectura de Moodle se añaden aquí cuando existan sus funciones en el plugin.
    { provide: ASSISTANT_TOOLS, useValue: [] as AssistantTool[] },
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
