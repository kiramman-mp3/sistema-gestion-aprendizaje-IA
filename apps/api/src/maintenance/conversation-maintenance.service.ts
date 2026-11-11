import { Injectable, Logger } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";

/** Máximo de conversaciones por ejecución, para que una tarea no ocupe la base mucho tiempo. */
const BATCH_SIZE = 200;

/**
 * Borra las conversaciones del asistente cuyo plazo de conservación venció (`AI_CONVERSATION_RETENTION_DAYS`,
 * provisional hasta la política D-08). Sus mensajes se borran en cascada. Es idempotente: repetirla no
 * cambia el resultado.
 */
@Injectable()
export class ConversationMaintenanceService {
  private readonly logger = new Logger(ConversationMaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async purgeExpiredConversations(now = new Date()): Promise<number> {
    const expired = await this.prisma.aiConversation.findMany({
      where: { retainUntil: { lt: now } },
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (expired.length === 0) return 0;

    const { count } = await this.prisma.aiConversation.deleteMany({
      where: { id: { in: expired.map((conversation) => conversation.id) } },
    });
    this.logger.log(`Conversaciones vencidas borradas: ${count}.`);
    // Un solo evento por ejecución y solo la cantidad: nada del contenido ni de quién era.
    await this.audit.record({
      action: "assistant.conversations_purged",
      outcome: "SUCCESS",
      resourceType: "ai_conversation",
      metadata: { count },
    });
    return count;
  }
}
