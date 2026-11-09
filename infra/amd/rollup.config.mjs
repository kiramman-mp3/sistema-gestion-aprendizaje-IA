// Compila los módulos ES de amd/src del plugin al formato AMD que sirve Moodle (amd/build/*.min.js),
// equivalente a lo que hace el grunt de Moodle core sin instalar sus dependencias.
//   pnpm build:amd
import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import terser from "@rollup/plugin-terser";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const plugins = [{ dir: "moodle/local/ai_assistant", component: "local_ai_assistant" }];

// Los módulos de Moodle (core/*, jquery, otros componentes) se cargan con RequireJS en el navegador.
const isMoodleModule = (id) => !id.startsWith(".") && !id.startsWith("/") && !/^[A-Za-z]:/.test(id);

export default plugins.flatMap(({ dir, component }) => {
  const src = join(root, dir, "amd", "src");
  return readdirSync(src)
    .filter((file) => file.endsWith(".js"))
    .map((file) => {
      const name = basename(file, ".js");
      return {
        input: join(src, file),
        external: isMoodleModule,
        output: {
          file: join(root, dir, "amd", "build", `${name}.min.js`),
          format: "amd",
          amd: { id: `${component}/${name}` },
          exports: "named",
          interop: "auto",
          sourcemap: true,
          sourcemapPathTransform: (path) => path.replace(/\\/g, "/"),
        },
        plugins: [terser({ format: { comments: false } })],
      };
    });
});
