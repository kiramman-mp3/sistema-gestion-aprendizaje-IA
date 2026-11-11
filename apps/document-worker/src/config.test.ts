import { isAbsolute } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("exige REDIS_URL sin mostrar su valor", () => {
    expect(() => loadConfig({ REDIS_URL: "valor-secreto" })).toThrow(/REDIS_URL/);
    expect(() => loadConfig({ REDIS_URL: "valor-secreto" })).not.toThrow(/secreto/);
  });

  it("resuelve una carpeta relativa igual que el backend y respeta las absolutas", () => {
    const relative = loadConfig({ REDIS_URL: "redis://localhost:6379" });
    expect(isAbsolute(relative.storageDir)).toBe(true);
    expect(relative.storageDir.replaceAll("\\", "/")).toMatch(/apps\/api\/var\/storage$/);
    expect(relative.concurrency).toBe(2);

    const absolute = loadConfig({ REDIS_URL: "redis://localhost:6379", STORAGE_DIR: "/data" });
    expect(absolute.storageDir).toBe("/data");
  });
});
