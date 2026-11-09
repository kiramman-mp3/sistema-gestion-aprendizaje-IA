/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/test"],
  testRegex: "\\.(spec|e2e-spec)\\.ts$",
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
  },
  // El cliente generado de Prisma importa archivos .ts con extensión .js (estilo NodeNext).
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  moduleFileExtensions: ["ts", "js", "json"],
  collectCoverageFrom: ["src/**/*.ts", "!src/main.ts", "!src/generated/**"],
};
