import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFileStorage } from "./file-storage";

describe("LocalFileStorage", () => {
  let root: string;
  let storage: LocalFileStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "smart-lms-storage-"));
    storage = new LocalFileStorage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("guarda, lee y borra un archivo con una clave aleatoria", async () => {
    const key = await storage.put("syllabi", "pdf", Buffer.from("contenido"));
    expect(key).toMatch(/^syllabi\/[0-9a-f-]{36}\.pdf$/);
    expect((await storage.read(key)).toString()).toBe("contenido");
    expect(await readdir(join(root, "syllabi"))).toHaveLength(1);

    await storage.delete(key);
    await expect(storage.read(key)).rejects.toThrow();
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });

  it("rechaza claves que no generó, incluidas las que salen de la raíz", async () => {
    await expect(storage.read("../secreto")).rejects.toThrow(/inválida/);
    await expect(storage.read("syllabi/../../etc/passwd")).rejects.toThrow(/inválida/);
    await expect(storage.delete("/etc/passwd")).rejects.toThrow(/inválida/);
  });
});
