import {
  MoodlePermissionError,
  MoodleUnavailableError,
} from "../../src/integrations/moodle/moodle.errors";
import type {
  PublishedModule,
  PublishedSection,
  PublishModuleInput,
  PublishSectionInput,
} from "../../src/integrations/moodle/moodle.types";

/**
 * Moodle simulado para las pruebas de publicación. Reproduce lo que importa del plugin real: reconoce un
 * elemento por su `itemId` y no lo duplica. Permite provocar los fallos que interesan a RF-09.
 */
export class FakeMoodle {
  sections = new Map<string, { sectionid: number; sectionnum: number; name: string }>();
  modules = new Map<
    string,
    { cmid: number; modname: string; sectionid: number; name: string; dueDate: string | null }
  >();
  /** Cada llamada de escritura, aunque falle. */
  calls: { fn: "section" | "module"; itemId: string }[] = [];

  /** Falla la llamada número N (1 = la primera) sin aplicarla, como una caída de Moodle. */
  failAtCall: number | null = null;
  /** Aplica la llamada número N pero pierde la respuesta, como un timeout. */
  loseResponseAtCall: number | null = null;
  /** Rechaza todas las llamadas por falta de permisos del docente. */
  denyPermissions = false;

  private nextId = 100;

  reset(): void {
    this.sections.clear();
    this.modules.clear();
    this.calls = [];
    this.failAtCall = null;
    this.loseResponseAtCall = null;
    this.denyPermissions = false;
    this.nextId = 100;
  }

  async publishSection(input: PublishSectionInput): Promise<PublishedSection> {
    const lost = this.begin("section", input.itemId);
    const existing = this.sections.get(input.itemId);
    const section = existing ?? {
      sectionid: this.nextId++,
      sectionnum: this.sections.size + 1,
      name: input.name,
    };
    this.sections.set(input.itemId, section);
    if (lost)
      throw new MoodleUnavailableError("Moodle no disponible (timeout).", "publish_section");
    return { sectionid: section.sectionid, sectionnum: section.sectionnum, created: !existing };
  }

  async publishModule(input: PublishModuleInput): Promise<PublishedModule> {
    const lost = this.begin("module", input.itemId);
    const existing = this.modules.get(input.itemId);
    const module = existing ?? {
      cmid: this.nextId++,
      modname: input.module,
      sectionid: input.sectionId,
      name: input.name,
      dueDate: input.dueDate,
    };
    this.modules.set(input.itemId, module);
    if (lost) throw new MoodleUnavailableError("Moodle no disponible (timeout).", "publish_module");
    return { cmid: module.cmid, created: !existing };
  }

  /** Registra la llamada y aplica los fallos programados; devuelve si se debe perder la respuesta. */
  private begin(fn: "section" | "module", itemId: string): boolean {
    this.calls.push({ fn, itemId });
    if (this.denyPermissions) {
      throw new MoodlePermissionError("publish", "nopermissions", "Sin permiso.");
    }
    const number = this.calls.length;
    if (this.failAtCall === number) {
      this.failAtCall = null;
      throw new MoodleUnavailableError("Moodle no disponible (red).", "publish");
    }
    if (this.loseResponseAtCall === number) {
      this.loseResponseAtCall = null;
      return true;
    }
    return false;
  }

  get createdCount(): number {
    return this.sections.size + this.modules.size;
  }
}
