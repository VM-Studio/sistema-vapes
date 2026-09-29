/**
 * Vacía TODOS los datos de negocio de todos los paneles: productos, sabores,
 * marcas, categorías, precios y escalones, proveedores y sus listas de
 * precios, clientes, ventas, compras, devoluciones, cotizaciones,
 * transferencias, movimientos y stock, y la auditoría de los paneles.
 *
 * Deja intactos: paneles, depósitos, usuarios con sus accesos y permisos,
 * sesiones, configuración global y por panel, backups y registros de login.
 * Las secuencias de numeración vuelven a 0 (la próxima venta es la 000001).
 * En storage local borra además los PDF de cotizaciones/comprobantes.
 *
 * Uso: pnpm db:limpiar-negocio            (pide escribir LIMPIAR)
 *      echo LIMPIAR | pnpm db:limpiar-negocio
 * Con NODE_ENV=production o una DATABASE_URL que no sea localhost/127.0.0.1
 * se niega salvo `--force` (y aun así pide la confirmación).
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";

import { PrismaClient } from "@prisma/client";

import {
  contarFilas,
  limpiarNegocio,
  TABLAS_NEGOCIO,
  TABLAS_PRESERVADAS,
} from "./lib/limpieza-negocio";

const CONFIRMACION = "LIMPIAR";
const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
/** Carpetas del storage local con archivos de negocio (no los backups ni los logos). */
const CARPETAS_NEGOCIO = ["cotizaciones", "comprobantes"];

function describirUrl(url: string): { host: string; base: string; local: boolean } {
  try {
    const u = new URL(url);
    return { host: u.hostname, base: u.pathname.slice(1), local: HOSTS_LOCALES.has(u.hostname) };
  } catch {
    return { host: "?", base: "?", local: false };
  }
}

async function confirmar(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const respuesta = await rl.question(
      `Esto BORRA todos los datos de negocio de todos los paneles. Escribí ${CONFIRMACION} para seguir: `,
    );
    return respuesta.trim() === CONFIRMACION;
  } catch {
    return false; // stdin cerrado sin respuesta
  } finally {
    rl.close();
  }
}

function tabla(titulo: string, filas: Record<string, number>) {
  console.log(`\n${titulo}`);
  const ancho = Math.max(...Object.keys(filas).map((t) => t.length));
  for (const [t, n] of Object.entries(filas)) console.log(`  ${t.padEnd(ancho)}  ${n}`);
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("Falta DATABASE_URL.");
  const { host, base, local } = describirUrl(url);
  const produccion = process.env.NODE_ENV === "production";
  const force = process.argv.includes("--force");

  console.log(`Base: ${base} en ${host}${produccion ? " (NODE_ENV=production)" : ""}`);
  if ((produccion || !local) && !force) {
    console.error(
      `✘ Bloqueado: ${produccion ? "NODE_ENV=production" : `la base no es local (${host})`}. ` +
        "Si de verdad querés vaciarla, repetí con --force.",
    );
    process.exitCode = 1;
    return;
  }
  if (!(await confirmar())) {
    console.error("✘ Cancelado: no se borró nada.");
    process.exitCode = 1;
    return;
  }

  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const r = await limpiarNegocio(db);
    console.log(
      `\n✔ Datos de negocio borrados. Auditoría de paneles: ${r.auditoriaBorrada} filas; ` +
        `secuencias reiniciadas a 0: ${r.secuenciasReiniciadas}.`,
    );

    if ((process.env.STORAGE_PROVIDER ?? "local") === "local") {
      const raiz = path.resolve(process.env.STORAGE_DIR ?? ".storage");
      for (const c of CARPETAS_NEGOCIO)
        await rm(path.join(raiz, c), { recursive: true, force: true });
      console.log(`Storage local: borradas ${CARPETAS_NEGOCIO.join(", ")} en ${raiz}.`);
    } else {
      console.log("Storage S3: los PDF de cotizaciones del bucket no se tocan (quedan huérfanos).");
    }

    tabla("Tablas de negocio (COUNT(*)):", await contarFilas(db, TABLAS_NEGOCIO));
    tabla("Tablas preservadas (COUNT(*)):", await contarFilas(db, TABLAS_PRESERVADAS));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
