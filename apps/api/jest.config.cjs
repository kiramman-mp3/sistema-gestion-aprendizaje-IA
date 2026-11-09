/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
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
