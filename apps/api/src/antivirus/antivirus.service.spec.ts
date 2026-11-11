import { AntivirusService } from "./antivirus.service";
import type { ClamavClient } from "./clamav.client";

function serviceWith(client: Partial<ClamavClient> | null): AntivirusService {
  return new AntivirusService(client as ClamavClient | null);
}

describe("AntivirusService", () => {
  it("omite el análisis si no hay clamd configurado", async () => {
    const service = serviceWith(null);
    expect(service.enabled).toBe(false);
    await expect(service.scan(Buffer.from("x"))).resolves.toEqual({ status: "skipped" });
    await expect(service.isHealthy()).resolves.toBe(false);
  });

  it("traduce la respuesta de clamd", async () => {
    const scan = jest
      .fn()
      .mockResolvedValueOnce({ clean: true })
      .mockResolvedValueOnce({ clean: false, signature: "Eicar-Test-Signature" });
    const service = serviceWith({ scan, ping: jest.fn().mockResolvedValue(true) });

    await expect(service.scan(Buffer.from("a"))).resolves.toEqual({ status: "clean" });
    await expect(service.scan(Buffer.from("b"))).resolves.toEqual({
      status: "infected",
      signature: "Eicar-Test-Signature",
    });
    await expect(service.isHealthy()).resolves.toBe(true);
  });
});
