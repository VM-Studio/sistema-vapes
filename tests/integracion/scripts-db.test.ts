import { spawnSync } from "node:child_process";

import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { prepararBaseDeTest } from "../../e2e/global-setup";

import { URL_VITEST } from "./setup";

/**
 * Los tests de la base (Prompts 1–5) son scripts que ejercitan los servicios
 * reales contra PostgreSQL con sus triggers: acá corren dentro de vitest,
 * sobre la base aislada, y fallan si el script informa algún ✘.
 */
function correr(script: string, url = URL_VITEST) {
  const ruta = script.includes("/") ? script : `scripts/${script}`;
  const r = spawnSync("npx", ["tsx", "--conditions=react-server", ruta], {
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: url,
      DIRECT_URL: url,
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
      "concurrencia de ventas (10 vendedores, stock 5, numeración sin huecos)",
      "test-ventas-concurrentes.ts",
    ],
    ["cotizador (escalones, conversión en venta, permisos, aislamiento)", "test-cotizador.ts"],
  ])("%s", (_nombre, script) => {
    const r = correr(script);
    if (!r.ok) console.log(r.salida);
    expect(r.ok).toBe(true);
  });

  // En una base propia: el seed demo llena los tres paneles y los demás tests esperan la base limpia.
  it("seed demo de los tres paneles con los servicios reales", async () => {
    const url = URL_VITEST.replace(/\/([^/?]+)(\?|$)/, "/$1_demo$2");
    await prepararBaseDeTest(url);
    const r = correr("prisma/seed-demo.ts", url);
    if (!r.ok) console.log(r.salida);
    expect(r.ok).toBe(true);
    const db = new PrismaClient({ datasources: { db: { url } } });
    try {
      const vapes = { panelId: "pnl_vapes" };
      expect(await db.venta.count({ where: vapes })).toBeGreaterThanOrEqual(300);
      expect(
        await db.cliente.count({ where: { ...vapes, deletedAt: null } }),
      ).toBeGreaterThanOrEqual(80);
      expect(
        await db.compra.count({ where: { ...vapes, estado: "RECIBIDA" } }),
      ).toBeGreaterThanOrEqual(20);
      expect(
        await db.venta.count({ where: { ...vapes, cotizacionId: { not: null } } }),
      ).toBeGreaterThan(0);
      expect(await db.proveedorProductoHistorial.count({ where: vapes })).toBeGreaterThan(0);
      for (const panelId of ["pnl_cosmetic", "pnl_especiales"]) {
        expect(await db.venta.count({ where: { panelId } })).toBeGreaterThan(0);
      }
    } finally {
      await db.$disconnect();
    }
  });
});
