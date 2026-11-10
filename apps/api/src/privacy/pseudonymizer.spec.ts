import { Pseudonymizer } from "./pseudonymizer";

const SECRET = "una-clave-de-prueba-de-al-menos-32-caracteres";

describe("Pseudonymizer", () => {
  it("da el mismo seudónimo al mismo estudiante en cada petición, sin tabla guardada", () => {
    const first = new Pseudonymizer(SECRET, 7).alias(1001);
    const second = new Pseudonymizer(SECRET, 7).alias(1001);

    expect(first).toMatch(/^Estudiante#\d{8}$/);
    expect(second).toBe(first);
  });

  it("cambia el seudónimo con otro curso, otro estudiante u otra clave", () => {
    const base = new Pseudonymizer(SECRET, 7).alias(1001);

    expect(new Pseudonymizer(SECRET, 8).alias(1001)).not.toBe(base);
    expect(new Pseudonymizer(SECRET, 7).alias(1002)).not.toBe(base);
    expect(new Pseudonymizer(`${SECRET}-otra`, 7).alias(1001)).not.toBe(base);
  });

  it("no revela el id en el seudónimo", () => {
    expect(new Pseudonymizer(SECRET, 7).alias(1001)).not.toContain("1001");
  });

  it("evita que dos estudiantes compartan seudónimo", () => {
    const p = new Pseudonymizer(SECRET, 7);
    const aliases = new Set(Array.from({ length: 2_000 }, (_, i) => p.alias(i + 1)));

    expect(aliases.size).toBe(2_000);
  });

  it("rechaza una clave corta", () => {
    expect(() => new Pseudonymizer("corta", 7)).toThrow(/32/);
  });

  describe("pseudonymize", () => {
    it("sustituye el nombre completo y sus partes, sin importar tildes ni mayúsculas", () => {
      const p = new Pseudonymizer(SECRET, 7);
      p.registerName(1001, "Ana María Pérez");
      const alias = p.alias(1001);

      expect(p.pseudonymize("¿Cómo va ANA MARIA PEREZ en la unidad 2?")).toBe(
        `¿Cómo va ${alias} en la unidad 2?`,
      );
      expect(p.pseudonymize("Revisa a Pérez, por favor")).toBe(`Revisa a ${alias}, por favor`);
    });

    it("no sustituye una palabra que solo contiene el nombre", () => {
      const p = new Pseudonymizer(SECRET, 7);
      p.registerName(1001, "Ana Pérez");

      expect(p.pseudonymize("La semana y el anaquel")).toBe("La semana y el anaquel");
    });

    it("quita correos y números largos como cédulas o teléfonos", () => {
      const p = new Pseudonymizer(SECRET, 7);

      expect(
        p.pseudonymize("Escribe a ana@uta.edu.ec o llama al 0991234567 (cédula 1801234567)"),
      ).toBe("Escribe a [correo] o llama al [número] (cédula [número])");
    });

    it("no toca números cortos como notas o fechas, ni los seudónimos", () => {
      const p = new Pseudonymizer(SECRET, 7);
      const alias = p.alias(5);

      expect(p.pseudonymize(`Nota 8.5 de 10 el 2026-12-04 para ${alias}`)).toBe(
        `Nota 8.5 de 10 el 2026-12-04 para ${alias}`,
      );
    });
  });

  describe("restore", () => {
    it("devuelve los ids de los seudónimos que aparecen en la respuesta", () => {
      const p = new Pseudonymizer(SECRET, 7);
      const a = p.alias(1001);
      const b = p.alias(1002);

      expect(p.restore(`${a} no entregó; ${b} sí; ${a} otra vez`)).toEqual([
        { alias: a, studentId: 1001 },
        { alias: b, studentId: 1002 },
      ]);
    });

    it("ignora seudónimos que esta petición no entregó", () => {
      const p = new Pseudonymizer(SECRET, 7);
      p.alias(1001);

      expect(p.restore("Estudiante#12345678 faltó")).toEqual([]);
      expect(p.unknownAliases("Estudiante#12345678 faltó")).toEqual(["Estudiante#12345678"]);
    });
  });
});
