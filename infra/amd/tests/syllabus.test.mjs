// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSyllabusExtraction } from "../../../packages/contracts/src/syllabus/fixtures.ts";
import { backend } from "./stubs/assistant.mjs";
import { init } from "../../../moodle/local/ai_assistant/amd/src/syllabus.js";

const SYLLABUS_ID = "33333333-3333-4333-8333-333333333333";

const syllabus = (status, extra = {}) => ({
  id: SYLLABUS_ID,
  status,
  progress: 100,
  pageCount: 3,
  textConfidence: "high",
  errorCode: null,
  ...extra,
});

const region = () => document.querySelector('[data-region="syllabus"]');
const status = () => document.querySelector('[data-region="syllabus-status"]');
const editor = () => document.querySelector('[data-region="extraction-editor"]');
const calls = () => backend.calls.map((call) => `${call.method} ${call.path}`);
const submitWith = (action) => {
  const form = region().querySelector("form");
  const file = new File(["%PDF-1.4"], "silabo.pdf", { type: "application/pdf" });
  Object.defineProperty(form.elements.file, "files", { value: [file], configurable: true });
  form.requestSubmit(form.querySelector(`[data-action="${action}"]`));
};
const button = (label) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent.includes(label));

/**
 * Backend simulado del recorrido: subir deja el texto listo (`textStatus`), pedir la extracción pasa el sílabo
 * a EXTRACTED y la extracción se entrega como la devuelve la API.
 */
const serve = (textStatus = syllabus("TEXT_READY")) => {
  let current = textStatus;
  backend.calls = [];
  backend.handler = async (call) => {
    const key = `${call.method} ${call.path}`;
    if (key === "POST /syllabi") return { id: SYLLABUS_ID };
    if (key === `GET /syllabi/${SYLLABUS_ID}`) return structuredClone(current);
    if (key === `POST /syllabi/${SYLLABUS_ID}/extract`) {
      current = syllabus("EXTRACTED");
      return current;
    }
    if (key === `GET /syllabi/${SYLLABUS_ID}/extraction`) {
      return {
        version: 1,
        schemaVersion: "1.0",
        source: "AI",
        content: buildSyllabusExtraction(),
        consistencyIssues: [],
        createdAt: "2026-11-11T12:00:00Z",
      };
    }
    throw Object.assign(new Error(`Ruta sin respuesta: ${key}`), { code: "NOT_FOUND" });
  };
};

beforeEach(() => {
  document.body.innerHTML = `
    <div data-region="local_ai_assistant">
      <section data-region="syllabus">
        <form data-action="upload-syllabus">
          <input type="file" name="file">
          <button type="submit" data-action="upload-and-structure">Upload and create the structure</button>
          <button type="submit" data-action="upload-only">Upload syllabus</button>
        </form>
        <div class="progress d-none" data-region="syllabus-progress">
          <div class="progress-bar" role="progressbar" style="width: 0%"></div>
        </div>
        <div data-region="syllabus-status"></div>
      </section>
      <section class="d-none" data-region="extraction-editor"></section>
      <section class="d-none" data-region="proposal-preview"></section>
    </div>`;
  // Un curso sin sílabos: lo que quedó de la prueba anterior no debe responder a la consulta de «el último».
  backend.calls = [];
  backend.handler = async () => {
    throw Object.assign(new Error("no"), { code: "SYLLABUS_NOT_FOUND", status: 404 });
  };
  init(7);
});

describe("subir y crear la estructura", () => {
  it("con el botón principal sube, extrae la estructura sin más clics y abre el editor", async () => {
    serve();

    submitWith("upload-and-structure");
    await vi.waitFor(() => expect(editor().classList.contains("d-none")).toBe(false));

    expect(calls()).toEqual([
      "POST /syllabi",
      `GET /syllabi/${SYLLABUS_ID}`,
      `POST /syllabi/${SYLLABUS_ID}/extract`,
      `GET /syllabi/${SYLLABUS_ID}`,
      `GET /syllabi/${SYLLABUS_ID}/extraction`,
    ]);
    expect(editor().textContent).toContain("Review the extracted structure");
  });

  it("con «Subir sílabo» solo lee el texto: no extrae y ofrece el botón de siempre", async () => {
    serve();

    submitWith("upload-only");
    await vi.waitFor(() => expect(button("Extract the course structure")).toBeDefined());

    expect(calls().some((call) => call.endsWith("/extract"))).toBe(false);
    expect(editor().classList.contains("d-none")).toBe(true);
  });

  it("un texto de OCR de baja confianza no sigue solo: avisa y deja decidir al docente", async () => {
    serve(syllabus("TEXT_READY", { textConfidence: "low" }));

    submitWith("upload-and-structure");
    await vi.waitFor(() => expect(button("Extract the course structure")).toBeDefined());

    expect(calls().some((call) => call.endsWith("/extract"))).toBe(false);
    expect(status().querySelector(".alert-warning")).not.toBeNull();
  });

  it("si la extracción falla lo dice y no abre el editor", async () => {
    serve();
    const previous = backend.handler;
    backend.handler = async (call) => {
      if (call.path.endsWith("/extract")) {
        throw Object.assign(new Error("x"), { code: "AI_PROVIDER_UNAVAILABLE" });
      }
      return previous(call);
    };

    submitWith("upload-and-structure");
    await vi.waitFor(() => expect(status().querySelector('[role="alert"]')).not.toBeNull());

    expect(status().textContent).toContain("AI_PROVIDER_UNAVAILABLE");
    expect(editor().classList.contains("d-none")).toBe(true);
  });

  it("no extrae si el archivo no es PDF ni DOCX", async () => {
    serve();
    const form = region().querySelector("form");
    const file = new File(["x"], "notas.txt", { type: "text/plain" });
    Object.defineProperty(form.elements.file, "files", { value: [file], configurable: true });

    form.requestSubmit(form.querySelector('[data-action="upload-and-structure"]'));
    await vi.waitFor(() => expect(status().textContent).not.toBe(""));

    expect(calls()).toEqual([]);
  });
});

describe("retomar el último sílabo al abrir la página", () => {
  /** Backend con un sílabo ya cargado en el curso: `latest` es lo que responde /syllabi/latest. */
  const serveLatest = (current) => {
    backend.calls = [];
    backend.handler = async (call) => {
      const key = `${call.method} ${call.path}`;
      if (key === "GET /syllabi/latest") {
        if (!current)
          throw Object.assign(new Error("no"), { code: "SYLLABUS_NOT_FOUND", status: 404 });
        return structuredClone(current);
      }
      if (key === `GET /syllabi/${SYLLABUS_ID}`) return structuredClone(current);
      if (key === `GET /syllabi/${SYLLABUS_ID}/extraction`) {
        return {
          version: 2,
          schemaVersion: "1.0",
          source: "TEACHER",
          content: buildSyllabusExtraction(),
          consistencyIssues: [],
          createdAt: "2026-11-11T12:00:00Z",
        };
      }
      throw Object.assign(new Error(`Ruta sin respuesta: ${key}`), { code: "NOT_FOUND" });
    };
  };

  it("un sílabo ya revisado abre el editor con su última versión, sin pasar por la URL", async () => {
    serveLatest(syllabus("REVIEWED"));

    init(7);
    await vi.waitFor(() => expect(editor().classList.contains("d-none")).toBe(false));

    expect(calls()[0]).toBe("GET /syllabi/latest");
    expect(calls()).toContain(`GET /syllabi/${SYLLABUS_ID}/extraction`);
  });

  it("un sílabo con el texto listo ofrece extraer la estructura", async () => {
    serveLatest(syllabus("TEXT_READY"));

    init(7);
    await vi.waitFor(() => expect(button("Extract the course structure")).toBeDefined());

    expect(editor().classList.contains("d-none")).toBe(true);
  });

  it("un curso sin sílabos no muestra nada y no falla", async () => {
    serveLatest(null);

    init(7);
    await vi.waitFor(() => expect(calls()).toEqual(["GET /syllabi/latest"]));

    expect(status().textContent).toBe("");
    expect(editor().classList.contains("d-none")).toBe(true);
  });

  it("con un sílabo en la dirección usa ese y no pregunta por el último", async () => {
    serveLatest(syllabus("REVIEWED"));

    init(7, SYLLABUS_ID);
    await vi.waitFor(() => expect(editor().classList.contains("d-none")).toBe(false));

    expect(calls()).not.toContain("GET /syllabi/latest");
  });
});
