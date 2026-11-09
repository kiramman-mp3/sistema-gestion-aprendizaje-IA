// Genera el JSON Schema del sílabo a partir del esquema Zod compilado en dist/.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { SYLLABUS_SCHEMA_VERSION, syllabusExtractionSchema } from "../dist/index.js";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "json-schema");
mkdirSync(outDir, { recursive: true });

const jsonSchema = {
  $id: `https://smart-lms.local/schemas/syllabus-extraction-${SYLLABUS_SCHEMA_VERSION}.json`,
  title: `Extracción estructurada de sílabo v${SYLLABUS_SCHEMA_VERSION}`,
  ...z.toJSONSchema(syllabusExtractionSchema),
};

const file = join(outDir, `syllabus-extraction-${SYLLABUS_SCHEMA_VERSION}.json`);
writeFileSync(file, `${JSON.stringify(jsonSchema, null, 2)}\n`);
console.log(`JSON Schema escrito en ${file}`);
