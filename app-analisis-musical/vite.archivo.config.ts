// Build de un solo archivo HTML (JS, CSS y worker incrustados) que funciona
// abriéndolo con doble clic, sin servidor: `npm run build:archivo`.
import { defineConfig, mergeConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import base from "./vite.config";

export default mergeConfig(
  base,
  defineConfig({
    plugins: [viteSingleFile()],
    publicDir: false,
    build: { outDir: "dist-archivo" },
  }),
);
