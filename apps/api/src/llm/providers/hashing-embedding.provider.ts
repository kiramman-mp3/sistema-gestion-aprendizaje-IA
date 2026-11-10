import { createHash } from "node:crypto";
import { EmbeddingProvider, type EmbeddingResult } from "../embedding-provider";

/** Dimensión de los vectores; debe coincidir con `vector(1024)` de la migración de `document_chunks`. */
export const HASHING_EMBEDDING_DIMENSIONS = 1024;

/** Palabras muy frecuentes que no ayudan a distinguir un fragmento de otro. */
const STOPWORDS = new Set(
  "a al algo con de del el ella en entre es esta este ha la las lo los mas me mi no o para pero por que se si sin sobre su sus un una uno y ya cual cuales como cuando donde dice dicen segun hay documento documentos silabo curso quien quienes".split(
    " ",
  ),
);

/** Minúsculas, sin tildes y separado en palabras. */
export function tokenize(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

function bucket(feature: string): { index: number; sign: 1 | -1 } {
  const digest = createHash("sha256").update(feature).digest();
  return {
    index: digest.readUInt32BE(0) % HASHING_EMBEDDING_DIMENSIONS,
    sign: (digest[4]! & 1) === 0 ? 1 : -1,
  };
}

/** Vector de un texto: bolsa de palabras y de pares de palabras con *feature hashing*, normalizado a longitud 1. */
export function embedText(text: string): number[] {
  const vector = new Array<number>(HASHING_EMBEDDING_DIMENSIONS).fill(0);
  const words = tokenize(text);
  const features = [...words, ...words.slice(1).map((word, i) => `${words[i]} ${word}`)];
  for (const feature of features) {
    const { index, sign } = bucket(feature);
    // Los pares pesan menos que las palabras sueltas.
    vector[index] = (vector[index] ?? 0) + sign * (feature.includes(" ") ? 0.5 : 1);
  }
  // Frecuencia atenuada: repetir una palabra diez veces no pesa diez veces más.
  const damped = vector.map((value) => Math.sign(value) * Math.sqrt(Math.abs(value)));
  const norm = Math.hypot(...damped);
  return norm === 0 ? damped : damped.map((value) => value / norm);
}

/**
 * Embeddings de demostración (`AI_PROVIDER=mock`): deterministas, sin red ni costo. Capturan solo coincidencia de
 * palabras, no significado, así que sirven para ejercitar la indexación, la búsqueda y el filtro por curso, pero
 * **no** para medir la calidad de la recuperación. Esa medición necesita el modelo real (D-07).
 */
export class HashingEmbeddingProvider extends EmbeddingProvider {
  readonly name = "hashing";
  readonly model = "hashing-1024-v1";
  /** Con pocas palabras en común el coseno es bajo aunque el fragmento sea el correcto. */
  readonly minScore = 0.06;
  readonly dimensions = HASHING_EMBEDDING_DIMENSIONS;

  async embed(texts: string[]): Promise<EmbeddingResult> {
    return { vectors: texts.map(embedText), model: this.model, dimensions: this.dimensions };
  }
}
