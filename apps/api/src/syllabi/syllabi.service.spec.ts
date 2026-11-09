import type { ConfigService } from "@nestjs/config";
import type { AntivirusService } from "../antivirus/antivirus.service";
import type { AuditService } from "../audit/audit.service";
import type { Env } from "../config/env";
import type { PrismaService } from "../database/prisma.service";
import type { IntegrationAccountService } from "../integrations/integration-account.service";
import type { FileStorage } from "../storage/file-storage";
import { minimalPdf } from "../../test/support/documents";
import { cleanFilename, SyllabiService } from "./syllabi.service";

describe("cleanFilename", () => {
  it("quita rutas y caracteres de control", () => {
    expect(cleanFilename("C:\\Users\\docente\\Sílabo.pdf", "pdf")).toBe("Sílabo.pdf");
    expect(cleanFilename("../../etc/silabo.pdf", "pdf")).toBe("silabo.pdf");
    expect(cleanFilename("si\u0000la\nbo.docx", "docx")).toBe("silabo.docx");
  });

  it("usa un nombre por defecto si no queda nada y conserva la extensión al recortar", () => {
    expect(cleanFilename("  \u0001 ", "pdf")).toBe("silabo.pdf");
    const long = `${"a".repeat(300)}.docx`;
    expect(cleanFilename(long, "docx")).toHaveLength(255);
    expect(cleanFilename(long, "docx").endsWith(".docx")).toBe(true);
  });
});

describe("SyllabiService", () => {
  it("borra el archivo guardado si falla el registro en la base", async () => {
    const storage = {
      put: jest.fn().mockResolvedValue("syllabi/00000000-0000-4000-8000-000000000001.pdf"),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const prisma = {
      syllabusDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(new Error("base caída")),
      },
    };
    const service = new SyllabiService(
      prisma as unknown as PrismaService,
      storage as unknown as FileStorage,
      { scan: async () => ({ status: "clean" }) } as unknown as AntivirusService,
      { record: jest.fn() } as unknown as AuditService,
      { currentId: async () => "cuenta-1" } as unknown as IntegrationAccountService,
      { get: () => 30 } as unknown as ConfigService<Env, true>,
    );
    const content = minimalPdf();

    await expect(
      service.upload({ moodleUserId: 42, courseId: 7 }, 7, {
        originalname: "silabo.pdf",
        buffer: content,
        size: content.length,
      }),
    ).rejects.toThrow("base caída");
    expect(storage.delete).toHaveBeenCalledWith("syllabi/00000000-0000-4000-8000-000000000001.pdf");
  });
});
