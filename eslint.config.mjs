import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/generated/**",
      // Módulos AMD compilados por infra/amd/rollup.config.mjs.
      "moodle/**/amd/build/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Código del plugin que se ejecuta en el navegador dentro de Moodle y sus pruebas (DOM simulado).
    files: ["moodle/**/amd/src/**/*.js", "infra/amd/tests/**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.browser },
    },
  },
  prettier,
);
