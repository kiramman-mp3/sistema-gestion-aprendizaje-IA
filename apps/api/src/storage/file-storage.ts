import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

/**
 * Almacén de archivos subidos. Hoy es una carpeta local compartida con el worker documental; la
 * interfaz permite cambiarlo por un almacén de objetos sin tocar a quien lo usa.
 */
export abstract class FileStorage {
  /** Guarda el contenido y devuelve la clave con que se recupera. */
  abstract put(prefix: string, extension: string, content: Buffer): Promise<string>;
  abstract read(key: string): Promise<Buffer>;
  /** Borra el archivo. No falla si ya no existe. */
  abstract delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^[a-z0-9-]+\/[0-9a-f-]{36}\.[a-z0-9]+$/;

export class LocalFileStorage extends FileStorage {
  private readonly root: string;

  constructor(root: string) {
    super();
    this.root = resolve(root);
  }

  async put(prefix: string, extension: string, content: Buffer): Promise<string> {
    const key = `${prefix}/${randomUUID()}.${extension}`;
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    // Se escribe a un temporal y se renombra: el worker nunca ve un archivo a medias.
    const temporary = `${path}.part`;
    await writeFile(temporary, content, { mode: 0o640 });
    await rename(temporary, path);
    return key;
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.pathOf(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  /** Las claves las genera `put`; cualquier otra forma se rechaza para evitar rutas fuera de la raíz. */
  private pathOf(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error("Clave de almacenamiento inválida.");
    const path = resolve(this.root, key);
    const fromRoot = relative(this.root, path);
    if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
      throw new Error("Clave de almacenamiento inválida.");
    }
    return path;
  }
}
