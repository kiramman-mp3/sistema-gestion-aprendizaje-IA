import { defineConfig } from "vitest/config";

export default defineConfig({
  // Los contratos se prueban desde su código fuente, sin compilarlos antes.
  resolve: { conditions: ["smart-lms-source"] },
  test: { include: ["src/**/*.test.ts"] },
});
