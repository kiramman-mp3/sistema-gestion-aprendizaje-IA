import { Socket } from "node:net";

export type ScanResult = { clean: true } | { clean: false; signature: string };

/** clamd no respondió, respondió con error o tardó demasiado. */
export class AntivirusUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AntivirusUnavailableError";
  }
}

/** clamd acepta trozos de hasta StreamMaxLength; 64 KB queda muy por debajo del valor por defecto. */
const CHUNK_SIZE = 64 * 1024;

/**
 * Cliente mínimo del protocolo de clamd (comandos `zINSTREAM` y `zPING`) sobre TCP. No usa
 * dependencias: el protocolo son unas pocas líneas y así no se suma código de terceros a la ruta de
 * los archivos subidos.
 */
export class ClamavClient {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs: number,
  ) {}

  static fromUrl(url: string, timeoutMs: number): ClamavClient {
    const parsed = new URL(url);
    return new ClamavClient(parsed.hostname, Number(parsed.port || 3310), timeoutMs);
  }

  async scan(content: Buffer): Promise<ScanResult> {
    const frames: Buffer[] = [Buffer.from("zINSTREAM\0")];
    for (let offset = 0; offset < content.length; offset += CHUNK_SIZE) {
      const chunk = content.subarray(offset, offset + CHUNK_SIZE);
      const size = Buffer.alloc(4);
      size.writeUInt32BE(chunk.length);
      frames.push(size, chunk);
    }
    frames.push(Buffer.alloc(4));

    const reply = await this.request(Buffer.concat(frames));
    if (!reply) throw new AntivirusUnavailableError("clamd cerró la conexión sin responder.");
    // Respuestas: "stream: OK" o "stream: <firma> FOUND"; cualquier otra cosa es un error de clamd.
    if (/^stream: OK$/.test(reply)) return { clean: true };
    const found = /^stream: (.+) FOUND$/.exec(reply);
    if (found?.[1]) return { clean: false, signature: found[1] };
    throw new AntivirusUnavailableError(`clamd respondió con error: ${reply.slice(0, 200)}`);
  }

  async ping(): Promise<boolean> {
    return (await this.request(Buffer.from("zPING\0"))) === "PONG";
  }

  private request(payload: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      const received: Buffer[] = [];
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) {
          reject(error);
          return;
        }
        resolve(Buffer.concat(received).toString("utf8").replace(/\0+$/, "").trim());
      };

      socket.setTimeout(this.timeoutMs, () =>
        finish(new AntivirusUnavailableError("clamd no respondió a tiempo.")),
      );
      socket.on("error", (error) =>
        finish(new AntivirusUnavailableError(`No se pudo conectar con clamd: ${error.message}`)),
      );
      socket.on("data", (data: Buffer) => {
        received.push(data);
        // Con el prefijo "z" la respuesta termina en NUL.
        if (data.includes(0)) finish();
      });
      socket.on("end", () => finish());
      socket.connect(this.port, this.host, () => socket.end(payload));
    });
  }
}
