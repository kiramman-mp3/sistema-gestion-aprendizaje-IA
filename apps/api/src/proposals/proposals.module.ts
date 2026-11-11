import { Module } from "@nestjs/common";
import { MoodleModule } from "../integrations/moodle/moodle.module";
import { PublishDispatcher, QueuePublishDispatcher } from "./publish-dispatcher";
import { ProposalPublishService } from "./proposal-publish.service";
import { ProposalPublisher } from "./proposal-publisher";
import { DEFAULT_PROPOSAL_POLICY, PROPOSAL_POLICY } from "./proposal-policy";
import { ProposalsController } from "./proposals.controller";
import { ProposalsService } from "./proposals.service";

@Module({
  imports: [MoodleModule],
  controllers: [ProposalsController],
  providers: [
    ProposalsService,
    ProposalPublishService,
    ProposalPublisher,
    { provide: PublishDispatcher, useClass: QueuePublishDispatcher },
    // Política provisional hasta cerrar D-04 y D-05; se reemplaza aquí sin tocar el resto.
    { provide: PROPOSAL_POLICY, useValue: DEFAULT_PROPOSAL_POLICY },
  ],
  exports: [ProposalsService],
})
export class ProposalsModule {}
