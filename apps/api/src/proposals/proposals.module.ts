import { Module } from "@nestjs/common";
import { DEFAULT_PROPOSAL_POLICY, PROPOSAL_POLICY } from "./proposal-policy";
import { ProposalsController } from "./proposals.controller";
import { ProposalsService } from "./proposals.service";

@Module({
  controllers: [ProposalsController],
  providers: [
    ProposalsService,
    // Política provisional hasta cerrar D-04 y D-05; se reemplaza aquí sin tocar el resto.
    { provide: PROPOSAL_POLICY, useValue: DEFAULT_PROPOSAL_POLICY },
  ],
  exports: [ProposalsService],
})
export class ProposalsModule {}
