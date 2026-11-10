import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
} from "@nestjs/common";
import { Auth, type AuthContext } from "../auth/auth-context";
import { RequireCapability } from "../auth/require-capability.decorator";
import { AuditAdminService, type AuditPageDto } from "./audit-admin.service";
import {
  DifficultyRulesAdminService,
  type DifficultyRuleDto,
} from "./difficulty-rules-admin.service";

/**
 * Administración institucional (CU-06 y CU-07). Exige `admin` además de `use`: quien administra el asistente es un
 * rol de gestión de Moodle (`local/ai_assistant:administer`), no un docente.
 */
@Controller()
@RequireCapability("admin")
export class AdminController {
  constructor(
    private readonly auditLog: AuditAdminService,
    private readonly rules: DifficultyRulesAdminService,
  ) {}

  @Get("audit")
  audit(@Auth() auth: AuthContext, @Query() query: unknown): Promise<AuditPageDto> {
    return this.auditLog.list(auth, query);
  }

  @Get("admin/difficulty-rules")
  listRules(@Query("courseId") courseId?: string) {
    return this.rules.list(courseId);
  }

  @Put("admin/difficulty-rules/:rule")
  putRule(
    @Auth() auth: AuthContext,
    @Param("rule") rule: string,
    @Body() body: unknown,
  ): Promise<DifficultyRuleDto> {
    return this.rules.put(auth, rule, body);
  }

  @Delete("admin/difficulty-rules/:rule")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeRule(
    @Auth() auth: AuthContext,
    @Param("rule") rule: string,
    @Query("courseId") courseId?: string,
  ): Promise<void> {
    return this.rules.remove(auth, rule, courseId);
  }
}
