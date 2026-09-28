import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { URL_VITEST } from "./setup";

/**
 * Los tests de la base (Prompts 1–5) son scripts que ejercitan los servicios
 * reales contra PostgreSQL con sus triggers: acá corren dentro de vitest,
 * sobre la base aislada, y fallan si el script informa algún ✘.
 */
function correr(script: string) {
  const r = spawnSync("npx", ["tsx", "--conditions=react-server", `scripts/${script}`], {
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: URL_VITEST,
      DIRECT_URL: URL_VITEST,
      PRISMA_LOG: "silent",
      LOG_LEVEL: "silent",
    },
  });
  const salida = `${r.stdout}\n${r.stderr}`;
  return { ok: r.status === 0 && !salida.includes("✘"), salida };
}

describe("integración con PostgreSQL", () => {
  it.each([
    ["motor de stock (ledger inmutable, caché = Σ ledger)", "test-stock.ts"],
    ["integridad de la DB (triggers, CHECK, documentos)", "test-integridad.ts"],
    [
      "concurrencia de ventas (10 cajas, stock 5, numeración sin huecos)",
      "test-ventas-concurrentes.ts",
    ],
    ["cotizador (escalones, conversión en venta, permisos, aislamiento)", "test-cotizador.ts"],
  ])("%s", (_nombre, script) => {
    const r = correr(script);
    if (!r.ok) console.log(r.salida);
    expect(r.ok).toBe(true);
  });
});
