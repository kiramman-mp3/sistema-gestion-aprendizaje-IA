import type { MoodleService } from "../integrations/moodle/moodle.service";
import type { CourseAccess } from "../integrations/moodle/moodle.types";
import type { RedisService } from "../redis/redis.service";
import { ACCESS_CACHE_TTL_SECONDS, AccessService } from "./access.service";

const access: CourseAccess = {
  userid: 4,
  courseid: 2,
  courseexists: true,
  active: true,
  roles: ["editingteacher"],
  capabilities: { use: true, publish: true, viewanalytics: true },
};

function setup(redisClient: Record<string, jest.Mock | string>) {
  const checkAccess = jest.fn().mockResolvedValue(access);
  const service = new AccessService(
    { checkAccess } as unknown as MoodleService,
    { client: { status: "ready", ...redisClient } } as unknown as RedisService,
  );
  return { service, checkAccess };
}

describe("AccessService", () => {
  it("consulta Moodle y guarda el resultado con TTL", async () => {
    const set = jest.fn().mockResolvedValue("OK");
    const { service, checkAccess } = setup({ get: jest.fn().mockResolvedValue(null), set });

    await expect(service.getAccess(4, 2)).resolves.toEqual(access);
    expect(checkAccess).toHaveBeenCalledWith(4, 2);
    expect(set).toHaveBeenCalledWith(
      "access:4:2",
      JSON.stringify(access),
      "EX",
      ACCESS_CACHE_TTL_SECONDS,
    );
  });

  it("usa la caché si existe", async () => {
    const { service, checkAccess } = setup({
      get: jest.fn().mockResolvedValue(JSON.stringify(access)),
      set: jest.fn(),
    });

    await expect(service.getAccess(4, 2)).resolves.toEqual(access);
    expect(checkAccess).not.toHaveBeenCalled();
  });

  it("ignora una entrada de caché corrupta", async () => {
    const { service, checkAccess } = setup({
      get: jest.fn().mockResolvedValue('{"roto":true}'),
      set: jest.fn().mockResolvedValue("OK"),
    });

    await service.getAccess(4, 2);
    expect(checkAccess).toHaveBeenCalled();
  });

  it("consulta Moodle aunque Redis falle", async () => {
    const { service, checkAccess } = setup({
      get: jest.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      set: jest.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });

    await expect(service.getAccess(4, 2)).resolves.toEqual(access);
    expect(checkAccess).toHaveBeenCalled();
  });
});
