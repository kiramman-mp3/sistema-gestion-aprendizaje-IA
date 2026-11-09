import { PrismaService } from "./prisma.service";

describe("PrismaService", () => {
  it("se identifica como la dependencia database", () => {
    expect(new PrismaService("postgresql://u:p@localhost:5432/db").name).toBe("database");
  });

  it("informa salud ejecutando SELECT 1", async () => {
    const service = new PrismaService("postgresql://u:p@localhost:5432/db");
    const queryRaw = jest.spyOn(service, "$queryRaw").mockResolvedValue([{ "?column?": 1 }]);

    await expect(service.isHealthy()).resolves.toBe(true);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
