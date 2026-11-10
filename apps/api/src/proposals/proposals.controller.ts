import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from "@nestjs/common";
import { Auth, type AuthContext } from "../auth/auth-context";
import { RequireCapability } from "../auth/require-capability.decorator";
import type { ProposalDto } from "./proposal.dto";
import { ProposalsService } from "./proposals.service";

/**
 * Propuestas de estructura de curso (RF-07, RF-08). Todas las rutas exigen `use`; las que cambian
 * algo exigen además `publish`, porque lo que se aprueba es lo que después se crea en Moodle.
 */
@Controller("proposals")
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  /** Genera una propuesta a partir de una versión de la extracción. */
  @Post()
  @RequireCapability("publish")
  create(@Auth() auth: AuthContext, @Body() body: unknown): Promise<ProposalDto> {
    return this.proposals.create(auth, body);
  }

  @Get(":proposalId")
  findOne(@Auth() auth: AuthContext, @Param("proposalId") id: string): Promise<ProposalDto> {
    return this.proposals.findOne(auth, id);
  }

  /** Reemplaza los elementos; una propuesta aprobada vuelve a revisión. */
  @Patch(":proposalId")
  @RequireCapability("publish")
  update(
    @Auth() auth: AuthContext,
    @Param("proposalId") id: string,
    @Body() body: unknown,
  ): Promise<ProposalDto> {
    return this.proposals.update(auth, id, body);
  }

  @Post(":proposalId/approve")
  @HttpCode(HttpStatus.OK)
  @RequireCapability("publish")
  approve(@Auth() auth: AuthContext, @Param("proposalId") id: string): Promise<ProposalDto> {
    return this.proposals.approve(auth, id);
  }
}
