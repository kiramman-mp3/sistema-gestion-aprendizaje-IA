// Doble de `core/str` de Moodle: lee las cadenas reales del plugin (inglés) y aplica los parámetros,
// de modo que una cadena que falte o un parámetro mal nombrado hace fallar las pruebas.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// `import.meta.dirname` en lugar de `new URL(...)`: en el entorno jsdom `URL` es el del navegador simulado.
const LANG_FILE = resolve(
  import.meta.dirname,
  "../../../../moodle/local/ai_assistant/lang/en/local_ai_assistant.php",
);

const catalog = new Map();
for (const match of readFileSync(LANG_FILE, "utf8").matchAll(
  /^\$string\['([^']+)'\] = '(.*)';\r?$/gm,
)) {
  // PHP escapa \' y \\ dentro de comillas simples.
  catalog.set(match[1], match[2].replace(/\\(['\\])/g, "$1"));
}

const fill = (text, param) => {
  if (param === undefined) return text;
  if (typeof param === "object") {
    return text.replace(/\{\$a->(\w+)\}/g, (_, name) => {
      if (!(name in param)) throw new Error(`Falta el parámetro ${name} de la cadena: ${text}`);
      return String(param[name]);
    });
  }
  return text.replaceAll("{$a}", String(param));
};

export const getString = async (key, component, param) => {
  if (!catalog.has(key)) throw new Error(`Cadena inexistente: ${key}`);
  return fill(catalog.get(key), param);
};

export const getStrings = (requests) =>
  Promise.all(requests.map((r) => getString(r.key, r.component, r.param)));
