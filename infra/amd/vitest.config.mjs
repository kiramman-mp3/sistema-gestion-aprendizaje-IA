import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Los contratos se prueban desde su código fuente, sin compilarlos antes.
      "@smart-lms/contracts": path("../../packages/contracts/src/index.ts"),
      // Módulos de Moodle que el JavaScript del plugin importa en el navegador.
      "core/str": path("./tests/stubs/core-str.mjs"),
      "local_ai_assistant/assistant": path("./tests/stubs/assistant.mjs"),
      "local_ai_assistant/extraction_model": path(
        "../../moodle/local/ai_assistant/amd/src/extraction_model.js",
      ),
      "local_ai_assistant/ui": path("../../moodle/local/ai_assistant/amd/src/ui.js"),
      "local_ai_assistant/proposal_model": path(
        "../../moodle/local/ai_assistant/amd/src/proposal_model.js",
      ),
      "local_ai_assistant/proposal_preview": path(
        "../../moodle/local/ai_assistant/amd/src/proposal_preview.js",
      ),
      "local_ai_assistant/extraction_editor": path(
        "../../moodle/local/ai_assistant/amd/src/extraction_editor.js",
      ),
    },
  },
  test: { include: ["tests/**/*.test.mjs"] },
});
