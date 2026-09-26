import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const raiz = path.dirname(fileURLToPath(import.meta.url));
const alias = {
  "@": path.join(raiz, "src"),
  "server-only": path.join(raiz, "tests/server-only-vacio.ts"),
};

/**
 * pnpm test = dos proyectos:
 *  - unit: lógica pura y componentes (jsdom), sin base de datos.
 *  - integracion: motor de stock, integridad de la DB y concurrencia de ventas
 *    contra una base AISLADA (DATABASE_URL_TEST_VITEST, se recrea al empezar).
 */
export default defineConfig({
  // El tsconfig de Next usa jsx: "preserve" (lo compila Next); para los tests, JSX automático.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}", "tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integracion",
          environment: "node",
          include: ["tests/integracion/**/*.test.ts"],
          globalSetup: ["tests/integracion/setup.ts"],
          testTimeout: 300_000,
          hookTimeout: 300_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
