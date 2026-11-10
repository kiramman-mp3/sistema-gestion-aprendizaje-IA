import { createHmac } from "node:crypto";

/** Prefijo de los seudónimos: `Estudiante#48392017`. */
export const ALIAS_PREFIX = "Estudiante#";
const ALIAS_PATTERN = /Estudiante#\d{8}/g;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Cédula ecuatoriana (10 dígitos) y teléfonos largos; se quitan del texto libre. */
const LONG_NUMBER = /(?<![\d#])\d{10,13}(?!\d)/g;

export const REDACTED_EMAIL = "[correo]";
export const REDACTED_NUMBER = "[número]";

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Seudonimización de estudiantes antes de llamar al proveedor de IA (ADR-010).
 *
 * El seudónimo se deriva con HMAC del id de Moodle y el curso, no se numera por orden de aparición:
 * así `Estudiante#48392017` es el mismo estudiante en cada turno de la conversación (el historial
 * guardado ya está seudonimizado) sin guardar ninguna tabla de correspondencia. Quien no tiene la
 * clave no puede pasar del seudónimo al id. La tabla inversa vive solo en esta instancia, durante la
 * petición.
 *
 * Los nombres no llegan al backend (los resuelve el plugin con Moodle), así que `restore` entrega
 * ids y no nombres: la respuesta lleva los seudónimos y el plugin los sustituye.
 */
export class Pseudonymizer {
  private readonly byAlias = new Map<string, number>();
  private readonly byId = new Map<number, string>();
  /** Nombres que el texto libre del docente puede mencionar y que deben sustituirse. */
  private readonly names: { pattern: RegExp; alias: string }[] = [];

  constructor(
    private readonly secret: string,
    private readonly courseId: number,
  ) {
    if (secret.length < 32) {
      throw new Error("La clave de seudonimización debe tener al menos 32 caracteres.");
    }
  }

  /** Seudónimo estable del estudiante; lo registra para poder restaurarlo después. */
  alias(studentId: number): string {
    const known = this.byId.get(studentId);
    if (known) return known;

    for (let attempt = 0; ; attempt++) {
      const digest = createHmac("sha256", this.secret)
        .update(`${this.courseId}:${studentId}:${attempt}`)
        .digest();
      const alias = `${ALIAS_PREFIX}${String(digest.readUInt32BE(0) % 100_000_000).padStart(8, "0")}`;
      // Dos estudiantes con el mismo seudónimo se confundirían: se prueba con otra derivación.
      if (this.byAlias.has(alias)) continue;
      this.byAlias.set(alias, studentId);
      this.byId.set(studentId, alias);
      return alias;
    }
  }

  /**
   * Hace que un nombre que escribió el docente se sustituya por el seudónimo del estudiante. Los
   * nombres solo se usan en esta petición; no se guardan.
   */
  registerName(studentId: number, fullName: string): void {
    const alias = this.alias(studentId);
    const parts = normalize(fullName)
      .split(/\s+/)
      .filter((part) => part.length >= 3);
    // El nombre completo primero, para que "Ana Pérez" no deje "Pérez" suelto.
    const candidates = [normalize(fullName).trim(), ...parts].filter(
      (value, index, all) => value.length >= 3 && all.indexOf(value) === index,
    );
    for (const candidate of candidates) {
      this.names.push({
        pattern: new RegExp(`(?<![\\p{L}\\d])${escapeRegExp(candidate)}(?![\\p{L}\\d])`, "giu"),
        alias,
      });
    }
  }

  /**
   * Texto libre hacia el proveedor: nombres registrados → seudónimo; correos y números largos
   * (cédula, teléfono) → marcador. Lo que no se reconoce no se toca: es una barrera adicional, no
   * una garantía (el texto libre de estudiantes depende de la política D-08).
   */
  pseudonymize(text: string): string {
    let result = text;
    const folded = normalize(text);
    // La normalización mantiene la longitud (NFD quita marcas, no letras base), salvo casos raros.
    if (folded.length === text.length) {
      const hits: { start: number; end: number; alias: string }[] = [];
      for (const { pattern, alias } of this.names) {
        pattern.lastIndex = 0;
        for (const match of folded.matchAll(pattern)) {
          hits.push({ start: match.index, end: match.index + match[0].length, alias });
        }
      }
      hits.sort((a, b) => a.start - b.start || b.end - a.end);
      let cursor = 0;
      let out = "";
      for (const hit of hits) {
        if (hit.start < cursor) continue;
        out += text.slice(cursor, hit.start) + hit.alias;
        cursor = hit.end;
      }
      result = out + text.slice(cursor);
    }
    return result.replace(EMAIL, REDACTED_EMAIL).replace(LONG_NUMBER, REDACTED_NUMBER);
  }

  /** Seudónimos que aparecen en un texto y los ids de Moodle a los que corresponden. */
  restore(text: string): { alias: string; studentId: number }[] {
    const found = new Map<string, number>();
    for (const alias of text.match(ALIAS_PATTERN) ?? []) {
      const studentId = this.byAlias.get(alias);
      if (studentId !== undefined) found.set(alias, studentId);
    }
    return [...found].map(([alias, studentId]) => ({ alias, studentId }));
  }

  /** Seudónimos que el modelo escribió pero que esta petición nunca entregó (inventados). */
  unknownAliases(text: string): string[] {
    return [...new Set(text.match(ALIAS_PATTERN) ?? [])].filter((a) => !this.byAlias.has(a));
  }
}
