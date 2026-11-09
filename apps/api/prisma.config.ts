import { config } from "dotenv";
import { expand } from "dotenv-expand";
import { defineConfig } from "prisma/config";

// El .env vive en la raíz del monorepo y usa ${VARIABLE}; Prisma no lo carga por sí solo.
expand(config({ path: ["../../.env", ".env"], quiet: true }));

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // `prisma generate` no necesita conexión; migrate sí.
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/unset",
  },
});
