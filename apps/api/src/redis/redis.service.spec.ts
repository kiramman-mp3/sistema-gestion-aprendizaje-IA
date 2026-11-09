import type { Redis } from "ioredis";
import { RedisService } from "./redis.service";

function fakeClient(status: string, ping: jest.Mock) {
  return { status, ping, connect: jest.fn().mockResolvedValue(undefined), quit: jest.fn() };
}

describe("RedisService", () => {
  it("conecta de forma diferida y responde PONG", async () => {
    const client = fakeClient("wait", jest.fn().mockResolvedValue("PONG"));
    const service = new RedisService(client as unknown as Redis);

    await expect(service.isHealthy()).resolves.toBe(true);
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it("no reconecta si ya está conectado", async () => {
    const client = fakeClient("ready", jest.fn().mockResolvedValue("PONG"));
    await new RedisService(client as unknown as Redis).isHealthy();

    expect(client.connect).not.toHaveBeenCalled();
  });

  it("propaga el error de conexión para marcar la dependencia como caída", async () => {
    const client = fakeClient("ready", jest.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await expect(new RedisService(client as unknown as Redis).isHealthy()).rejects.toThrow(
      "ECONNREFUSED",
    );
  });

  it("cierra la conexión al apagar solo si se abrió", async () => {
    const unused = fakeClient("wait", jest.fn());
    await new RedisService(unused as unknown as Redis).onModuleDestroy();
    expect(unused.quit).not.toHaveBeenCalled();

    const used = fakeClient("ready", jest.fn());
    await new RedisService(used as unknown as Redis).onModuleDestroy();
    expect(used.quit).toHaveBeenCalledTimes(1);
  });
});
