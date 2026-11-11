import { createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { AntivirusUnavailableError, ClamavClient } from "./clamav.client";

const openSockets = new Set<Socket>();

/** Servidor falso de clamd: decodifica INSTREAM y responde según el contenido recibido. */
function fakeClamd(reply: (command: string, content: Buffer) => string | null): Promise<Server> {
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    openSockets.add(socket);
    socket.on("close", () => openSockets.delete(socket));
    const chunks: Buffer[] = [];
    socket.on("data", (data: Buffer) => chunks.push(data));
    socket.on("end", () => {
      const raw = Buffer.concat(chunks);
      const commandEnd = raw.indexOf(0);
      const command = raw.toString("utf8", 0, commandEnd);
      const parts: Buffer[] = [];
      let offset = commandEnd + 1;
      while (command === "zINSTREAM" && offset + 4 <= raw.length) {
        const size = raw.readUInt32BE(offset);
        if (size === 0) break;
        parts.push(raw.subarray(offset + 4, offset + 4 + size));
        offset += 4 + size;
      }
      const answer = reply(command, Buffer.concat(parts));
      if (answer !== null) socket.end(`${answer}\0`);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function clientFor(server: Server, timeoutMs = 2000): ClamavClient {
  const { port } = server.address() as AddressInfo;
  return ClamavClient.fromUrl(`tcp://127.0.0.1:${port}`, timeoutMs);
}

describe("ClamavClient", () => {
  let server: Server | undefined;

  afterEach(async () => {
    openSockets.forEach((socket) => socket.destroy());
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
    server = undefined;
  });

  it("envía el archivo completo en trozos y reconoce un archivo limpio", async () => {
    let received: Buffer = Buffer.alloc(0);
    server = await fakeClamd((_, content) => {
      received = content;
      return "stream: OK";
    });
    const content = Buffer.alloc(200 * 1024, 7);

    await expect(clientFor(server).scan(content)).resolves.toEqual({ clean: true });
    expect(received.equals(content)).toBe(true);
  });

  it("devuelve la firma cuando clamd detecta malware", async () => {
    server = await fakeClamd(() => "stream: Eicar-Test-Signature FOUND");
    await expect(clientFor(server).scan(Buffer.from("x"))).resolves.toEqual({
      clean: false,
      signature: "Eicar-Test-Signature",
    });
  });

  it("trata cualquier otra respuesta como error de clamd", async () => {
    server = await fakeClamd(() => "INSTREAM size limit exceeded. ERROR");
    await expect(clientFor(server).scan(Buffer.from("x"))).rejects.toBeInstanceOf(
      AntivirusUnavailableError,
    );
  });

  it("falla si clamd no responde a tiempo", async () => {
    server = await fakeClamd(() => null);
    await expect(clientFor(server, 200).scan(Buffer.from("x"))).rejects.toThrow(/a tiempo/);
  });

  it("falla si clamd cierra la conexión sin responder", async () => {
    server = await fakeClamd(() => "");
    await expect(clientFor(server).scan(Buffer.from("x"))).rejects.toThrow(/sin responder/);
  });

  it("falla si no hay clamd escuchando", async () => {
    const client = ClamavClient.fromUrl("tcp://127.0.0.1:1", 1000);
    await expect(client.scan(Buffer.from("x"))).rejects.toThrow(/conectar/);
  });

  it("responde al ping", async () => {
    server = await fakeClamd((command) => (command === "zPING" ? "PONG" : "ERROR"));
    await expect(clientFor(server).ping()).resolves.toBe(true);
  });
});
