import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { prepararBaseDeTest } from "../../e2e/global-setup";
import { contarFilas, TABLAS_NEGOCIO } from "../../scripts/lib/limpieza-negocio";

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

/** `pnpm db:limpiar-negocio` contestando `respuesta` a la confirmación. */
function limpiar(url: string, respuesta: string) {
  const r = spawnSync("npx", ["tsx", "--conditions=react-server", "scripts/limpiar-negocio.ts"], {
    encoding: "utf8",
    input: `${respuesta}\n`,
    env: {
      ...process.env,
      DATABASE_URL: url,
      DIRECT_URL: url,
      NODE_ENV: "test",
      STORAGE_DIR: mkdtempSync(path.join(tmpdir(), "limpieza-")),
      PRISMA_LOG: "silent",
    },
  });
  return { ok: r.status === 0, salida: `${r.stdout}\n${r.stderr}` };
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

  // En una base propia: siembra catálogo + ventas y la vacía con `pnpm db:limpiar-negocio`.
  it("limpiar-negocio vacía los datos de negocio y preserva paneles, depósitos, usuarios y configuración", async () => {
    const url = URL_VITEST.replace(/\/([^/?]+)(\?|$)/, "/$1_limpieza$2");
    await prepararBaseDeTest(url);
    for (const script of ["e2e/fixtures/catalogo-ejemplo.ts", "test-ventas.ts"]) {
      const r = correr(script, url);
      if (!r.ok) console.log(r.salida);
      expect(r.ok).toBe(true);
    }
    const db = new PrismaClient({ datasources: { db: { url } } });
    try {
      const antes = await contarFilas(db, TABLAS_NEGOCIO);
      expect(antes.Venta).toBeGreaterThan(0);
      expect(antes.MovimientoStock).toBeGreaterThan(0);
      const preservadasAntes = await contarFilas(db, [
        "Panel",
        "Deposito",
        "Usuario",
        "Configuracion",
      ]);

      // Sin confirmación no borra nada; con una base remota se niega sin --force.
      expect(limpiar(url, "no").ok).toBe(false);
      expect((await contarFilas(db, ["Venta"])).Venta).toBe(antes.Venta);
      const remota = limpiar("postgresql://app:app@db.ejemplo.com:5432/gestion", "LIMPIAR");
      expect(remota.ok).toBe(false);
      expect(remota.salida).toContain("--force");

      const r = limpiar(url, "LIMPIAR");
      if (!r.ok) console.log(r.salida);
      expect(r.ok).toBe(true);
      const despues = await contarFilas(db, TABLAS_NEGOCIO);
      expect(Object.values(despues).every((n) => n === 0)).toBe(true);
      expect(await contarFilas(db, ["Panel", "Deposito", "Usuario", "Configuracion"])).toEqual(
        preservadasAntes,
      );
      expect(await db.auditLog.count({ where: { panelId: { not: null } } })).toBe(0);
      expect(await db.secuencia.count({ where: { ultimoNumero: { not: 0 } } })).toBe(0);
    } finally {
      await db.$disconnect();
    }
  });
});
