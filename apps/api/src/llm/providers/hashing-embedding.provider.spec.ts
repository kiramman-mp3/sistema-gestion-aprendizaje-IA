import {
  embedText,
  HASHING_EMBEDDING_DIMENSIONS,
  HashingEmbeddingProvider,
  tokenize,
} from "./hashing-embedding.provider";

const cosine = (a: number[], b: number[]): number => a.reduce((sum, v, i) => sum + v * b[i]!, 0);

describe("embeddings de demostración", () => {
  it("devuelve vectores de la dimensión de la base, de longitud 1", () => {
    const vector = embedText("Metodologías ágiles: Scrum y Kanban");

    expect(vector).toHaveLength(HASHING_EMBEDDING_DIMENSIONS);
    expect(Math.hypot(...vector)).toBeCloseTo(1, 6);
  });

  it("es determinista", () => {
    expect(embedText("bibliografía básica")).toEqual(embedText("bibliografía básica"));
  });

  it("ignora mayúsculas, tildes y signos", () => {
    expect(embedText("¿Cuál es la METODOLOGÍA?")).toEqual(embedText("cual es la metodologia"));
  });

  it("un texto con palabras en común se parece más que uno sin ellas", () => {
    const query = embedText("¿cómo se evalúa el aprendizaje autónomo?");
    const related = embedText(
      "El aprendizaje autónomo se evalúa con informes y ensayos del estudiante.",
    );
    const unrelated = embedText("Direcciones IPv4, subredes y protocolos de enrutamiento.");

    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated) + 0.1);
  });

  it("un texto vacío o solo de palabras vacías da el vector nulo, sin dividir por cero", () => {
    expect(embedText("")).toEqual(new Array(HASHING_EMBEDDING_DIMENSIONS).fill(0));
    expect(embedText("de la el y")).toEqual(new Array(HASHING_EMBEDDING_DIMENSIONS).fill(0));
  });

  it("repetir una palabra no la hace pesar proporcionalmente más", () => {
    const once = embedText("scrum kanban");
    const many = embedText("scrum scrum scrum scrum scrum scrum scrum scrum kanban");

    expect(cosine(once, many)).toBeGreaterThan(0.6);
  });

  it("separa las palabras sin tildes y descarta las muy frecuentes", () => {
    expect(tokenize("El análisis de la Evaluación, año 2026")).toEqual([
      "analisis",
      "evaluacion",
      "ano",
      "2026",
    ]);
  });

  it("el proveedor devuelve un vector por texto, en el mismo orden", async () => {
    const result = await new HashingEmbeddingProvider().embed(["uno dos", "tres cuatro"]);

    expect(result.model).toBe("hashing-1024-v1");
    expect(result.dimensions).toBe(HASHING_EMBEDDING_DIMENSIONS);
    expect(result.vectors).toEqual([embedText("uno dos"), embedText("tres cuatro")]);
  });
});
