import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { Auth, type AuthContext } from "../auth/auth-context";
import { RequireCapability } from "../auth/require-capability.decorator";
import { ProposalPublishService } from "./proposal-publish.service";
import type { ProposalDto } from "./proposal.dto";
import type { PublishOperationDto } from "./publish.dto";
import { ProposalsService } from "./proposals.service";

/**
 * Propuestas de estructura de curso (RF-07, RF-08). Todas las rutas exigen `use`; las que cambian
 * algo exigen además `publish`, porque lo que se aprueba es lo que después se crea en Moodle.
 */
@Controller("proposals")
export class ProposalsController {
  constructor(
    private readonly proposals: ProposalsService,
    private readonly publishing: ProposalPublishService,
  ) {}

  /** Genera una propuesta a partir de una versión de la extracción. */
  @Post()
  @RequireCapability("publish")
  create(@Auth() auth: AuthContext, @Body() body: unknown): Promise<ProposalDto> {
    return this.proposals.create(auth, body);
  }

  /** La propuesta más reciente del curso, para retomarla al abrir la página (antes que `:proposalId`). */
  @Get("latest")
  latest(@Auth() auth: AuthContext): Promise<ProposalDto> {
    return this.proposals.latest(auth);
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

  /**
   * Publica en Moodle una propuesta aprobada (RF-09). Exige `Idempotency-Key` y `{ "confirm": true }`.
   * Responde 202: la publicación sigue en segundo plano y se consulta con la operación devuelta.
   */
  @Post(":proposalId/publish")
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireCapability("publish")
  publish(
    @Auth() auth: AuthContext,
    @Param("proposalId") id: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<PublishOperationDto> {
    return this.publishing.start(auth, id, idempotencyKey, body);
  }

  /** Progreso y resultado de una publicación. */
  @Get(":proposalId/publish-operations/:operationId")
  publishOperation(
    @Auth() auth: AuthContext,
    @Param("proposalId") id: string,
    @Param("operationId") operationId: string,
  ): Promise<PublishOperationDto> {
    return this.publishing.getOperation(auth, id, operationId);
  }
}
