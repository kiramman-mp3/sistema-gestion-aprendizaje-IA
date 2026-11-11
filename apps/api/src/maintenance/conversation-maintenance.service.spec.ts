import type { AuditService } from "../audit/audit.service";
import type { PrismaService } from "../database/prisma.service";
import { ConversationMaintenanceService } from "./conversation-maintenance.service";

const NOW = new Date("2027-02-10T03:10:00Z");

function setup(expired: { id: string }[]) {
  const prisma = {
    aiConversation: {
      findMany: jest.fn().mockResolvedValue(expired),
      deleteMany: jest.fn().mockResolvedValue({ count: expired.length }),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ConversationMaintenanceService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, prisma, audit };
}

describe("ConversationMaintenanceService", () => {
  it("borra las conversaciones vencidas y audita solo la cantidad", async () => {
    const { service, prisma, audit } = setup([{ id: "c1" }, { id: "c2" }]);

    await expect(service.purgeExpiredConversations(NOW)).resolves.toBe(2);

    expect(prisma.aiConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { retainUntil: { lt: NOW } } }),
    );
    expect(prisma.aiConversation.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["c1", "c2"] } },
    });
    expect(audit.record).toHaveBeenCalledWith({
      action: "assistant.conversations_purged",
      outcome: "SUCCESS",
      resourceType: "ai_conversation",
      metadata: { count: 2 },
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("c1");
  });

  it("no borra ni audita si no hay nada vencido", async () => {
    const { service, prisma, audit } = setup([]);

    await expect(service.purgeExpiredConversations(NOW)).resolves.toBe(0);

    expect(prisma.aiConversation.deleteMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
