/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base relativa para poder desplegar en GitHub Pages en cualquier subruta
export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
