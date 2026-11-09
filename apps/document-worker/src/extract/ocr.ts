import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TextBlock } from "@smart-lms/contracts";
import { DocumentError } from "../errors.js";
import { normalizeText } from "./common.js";

/** Ejecuta un programa sin shell y devuelve su salida estándar. */
export type CommandRunner = (command: string, args: string[]) => Promise<string>;

/** OCR de páginas de un PDF escaneado. */
export interface PdfOcr {
  /** Devuelve los párrafos reconocidos en cada página pedida. */
  recognize(content: Uint8Array, pages: number[]): Promise<TextBlock[]>;
}

/** Un sílabo escaneado razonable cabe en este límite; cada página tarda varios segundos. */
export const MAX_OCR_PAGES = 40;
/** 200 ppp bastan para texto impreso y mantienen el tiempo por página acotado. */
const RESOLUTION_DPI = "200";
const COMMAND_TIMEOUT_MS = 120_000;

export const runCommand: CommandRunner = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });

/**
 * OCR con Poppler (`pdftoppm`, rasteriza cada página) y Tesseract en español. Los programas vienen
 * en la imagen del worker; se llaman con `execFile`, sin shell, y con archivos temporales propios.
 */
export class TesseractPdfOcr implements PdfOcr {
  constructor(
    private readonly run: CommandRunner = runCommand,
    private readonly language = "spa",
  ) {}

  /** Comprueba que los programas existen y que el idioma está instalado. */
  async isAvailable(): Promise<boolean> {
    try {
      await this.run("pdftoppm", ["-v"]);
      const languages = await this.run("tesseract", ["--list-langs"]);
      return languages.split(/\r?\n/).some((line) => line.trim() === this.language);
    } catch {
      return false;
    }
  }

  async recognize(content: Uint8Array, pages: number[]): Promise<TextBlock[]> {
    if (pages.length > MAX_OCR_PAGES) {
      throw new DocumentError("DOCUMENT_TOO_COMPLEX", `${pages.length} páginas para OCR`);
    }
    const workdir = await mkdtemp(join(tmpdir(), "smart-lms-ocr-"));
    try {
      const input = join(workdir, "input.pdf");
      await writeFile(input, content);
      const blocks: TextBlock[] = [];
      for (const page of pages) {
        const prefix = join(workdir, `page-${page}`);
        await this.run("pdftoppm", [
          "-r",
          RESOLUTION_DPI,
          "-gray",
          "-png",
          "-f",
          String(page),
          "-l",
          String(page),
          input,
          prefix,
        ]);
        // pdftoppm agrega el número de página con ceros a la izquierda según el total.
        const image = (await readdir(workdir)).find((name) => name.startsWith(`page-${page}-`));
        if (!image) continue;
        const text = await this.run("tesseract", [
          join(workdir, image),
          "stdout",
          "-l",
          this.language,
          "--psm",
          "3",
        ]);
        blocks.push(...toParagraphs(page, text));
      }
      return blocks;
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }
}

/** Tesseract separa los párrafos con líneas en blanco. */
export function toParagraphs(page: number, text: string): TextBlock[] {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => normalizeText(paragraph))
    .filter((paragraph) => /[\p{L}\p{N}]/u.test(paragraph))
    .map((paragraph) => ({ type: "paragraph", page, text: paragraph }));
}
