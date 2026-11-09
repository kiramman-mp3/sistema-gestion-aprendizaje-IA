import { z } from "zod";
import { MoodleClient } from "./moodle.client";
import {
  MoodleApiError,
  MoodleAuthError,
  MoodlePermissionError,
  MoodleResponseError,
  MoodleUnavailableError,
} from "./moodle.errors";

const TOKEN = "token-super-secreto";
const schema = z.object({ sitename: z.string() });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function buildClient(fetchFn: jest.Mock, baseUrl = "http://moodle.test") {
  return new MoodleClient({
    baseUrl,
    token: TOKEN,
    timeoutMs: 1_000,
    maxRetries: 2,
    fetchFn: fetchFn as unknown as typeof fetch,
    sleep: async () => undefined,
  });
}

const read = { readOnly: true } as const;
const write = { readOnly: false } as const;

describe("MoodleClient", () => {
  it("envía la función, el token y el formato JSON por POST", async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ sitename: "LMS" }));

    await expect(
      buildClient(fetchFn).call("core_webservice_get_site_info", { a: 1 }, schema, read),
    ).resolves.toEqual({ sitename: "LMS" });

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://moodle.test/webservice/rest/server.php");
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(init.body as URLSearchParams);
    expect(body.get("wsfunction")).toBe("core_webservice_get_site_info");
    expect(body.get("wstoken")).toBe(TOKEN);
    expect(body.get("moodlewsrestformat")).toBe("json");
    expect(body.get("a")).toBe("1");
  });

  it("respeta Moodle instalado en un subdirectorio", async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ sitename: "LMS" }));
    await buildClient(fetchFn, "http://host.test/moodle").call("f", {}, schema, read);

    expect(fetchFn.mock.calls[0]?.[0]).toBe("http://host.test/moodle/webservice/rest/server.php");
  });

  it.each([
    ["invalidtoken", MoodleAuthError],
    ["nopermissions", MoodlePermissionError],
    ["invalidparameter", MoodleApiError],
  ])("convierte la excepción %s de Moodle en %p", async (errorcode, ErrorClass) => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(jsonResponse({ exception: "moodle_exception", errorcode, message: "x" }));

    await expect(buildClient(fetchFn).call("f", {}, schema, read)).rejects.toBeInstanceOf(
      ErrorClass,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("reintenta lecturas ante errores 5xx", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ sitename: "LMS" }));

    await expect(buildClient(fetchFn).call("f", {}, schema, read)).resolves.toEqual({
      sitename: "LMS",
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("deja de reintentar tras el máximo de intentos", async () => {
    const fetchFn = jest.fn().mockRejectedValue(new TypeError("fetch failed"));

    await expect(buildClient(fetchFn).call("f", {}, schema, read)).rejects.toBeInstanceOf(
      MoodleUnavailableError,
    );
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("no reintenta escrituras para no duplicar elementos", async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({}, 503));

    await expect(buildClient(fetchFn).call("f", {}, schema, write)).rejects.toBeInstanceOf(
      MoodleUnavailableError,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("informa timeout como Moodle no disponible", async () => {
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    const fetchFn = jest.fn().mockRejectedValue(timeout);

    await expect(buildClient(fetchFn).call("f", {}, schema, write)).rejects.toThrow(/timeout/);
  });

  it("rechaza respuestas que no cumplen el esquema", async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ otro: 1 }));

    await expect(buildClient(fetchFn).call("f", {}, schema, read)).rejects.toBeInstanceOf(
      MoodleResponseError,
    );
  });

  it("no incluye el token en los mensajes de error", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(
        jsonResponse({ exception: "x", errorcode: "invalidtoken", message: "Token inválido" }),
      );

    const error = await buildClient(fetchFn)
      .call("f", {}, schema, read)
      .catch((e: Error) => e);
    expect(String((error as Error).message)).not.toContain(TOKEN);
    expect(JSON.stringify(error)).not.toContain(TOKEN);
  });
});
