import { HealthService } from "./health.service";

const indicator = (name: string, isHealthy: () => Promise<boolean>) => ({ name, isHealthy });

describe("HealthService", () => {
  it("informa ok sin dependencias registradas", async () => {
    await expect(new HealthService().check()).resolves.toEqual({ status: "ok", dependencies: {} });
  });

  it("informa degraded si alguna dependencia cae", async () => {
    const service = new HealthService();
    service.register(indicator("database", async () => true));
    service.register(indicator("redis", async () => false));

    await expect(service.check()).resolves.toEqual({
      status: "degraded",
      dependencies: { database: "ok", redis: "down" },
    });
  });

  it("informa down si todas caen y trata las excepciones como caída", async () => {
    const service = new HealthService();
    service.register(
      indicator("moodle", async () => {
        throw new Error("timeout");
      }),
    );

    await expect(service.check()).resolves.toEqual({
      status: "down",
      dependencies: { moodle: "down" },
    });
  });

  it("considera caída una dependencia que no responde a tiempo", async () => {
    jest.useFakeTimers();
    const service = new HealthService();
    service.register(indicator("lenta", () => new Promise<boolean>(() => undefined)));

    const report = service.check();
    await jest.advanceTimersByTimeAsync(3_000);

    await expect(report).resolves.toEqual({ status: "down", dependencies: { lenta: "down" } });
    jest.useRealTimers();
  });
});
