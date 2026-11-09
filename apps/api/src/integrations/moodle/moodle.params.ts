export type MoodleParamValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | MoodleParamValue[]
  | { [key: string]: MoodleParamValue };

/**
 * Codifica parámetros con la notación de arreglos de PHP que espera el protocolo REST de Moodle:
 * `{ courseids: [2, 3] }` → `courseids[0]=2&courseids[1]=3`. Los booleanos se envían como `1`/`0` y los
 * valores `null`/`undefined` se omiten.
 */
export function encodeMoodleParams(params: Record<string, MoodleParamValue>): URLSearchParams {
  const search = new URLSearchParams();

  const append = (key: string, value: MoodleParamValue): void => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => append(`${key}[${i}]`, item));
    } else if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) append(`${key}[${k}]`, v);
    } else if (typeof value === "boolean") {
      search.append(key, value ? "1" : "0");
    } else {
      search.append(key, String(value));
    }
  };

  for (const [key, value] of Object.entries(params)) append(key, value);
  return search;
}
