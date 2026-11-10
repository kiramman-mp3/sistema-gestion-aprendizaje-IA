/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  // Las pruebas no usan el límite de peticiones (necesita Redis); las que lo prueban lo activan ellas mismas.
  setupFiles: ["<rootDir>/test/support/test-env.ts"],
  roots: ["<rootDir>/src", "<rootDir>/test"],
  testRegex: "\\.(spec|e2e-spec)\\.ts$",
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
  },
  // El cliente generado de Prisma importa archivos .ts con extensión .js (estilo NodeNext).
  // Los contratos se prueban desde su código fuente, sin compilarlos antes.
  moduleNameMapper: {
    "^@smart-lms/contracts$": "<rootDir>/../../packages/contracts/src/index.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  moduleFileExtensions: ["ts", "js", "json"],
  collectCoverageFrom: ["src/**/*.ts", "!src/main.ts", "!src/generated/**"],
};
