/**
 * EXPLAIN (ANALYZE, BUFFERS) de las consultas más pesadas del dashboard y los
 * reportes, con el SQL EXACTO que emiten los servicios (se captura con el
 * log de queries de Prisma) sobre los datos de la base apuntada.
 * Uso: DATABASE_URL=…/gestion_demo PRISMA_LOG=query pnpm explain:reportes
 */
import type { Prisma } from "@prisma/client";

import { prisma } from "../src/lib/db";
import { ahora } from "../src/lib/reloj";
import { diaEn, sumarDias } from "../src/lib/zona-horaria";
import { obtenerZonaHoraria } from "../src/server/services/configuracion.service";
import { rankingVariantes, serieTemporal } from "../src/server/services/reporte.service";

type Evento = { query: string; params: string };
const capturadas: Evento[] = [];
(prisma as unknown as { $on: (e: "query", cb: (ev: Prisma.QueryEvent) => void) => void }).$on(
  "query",
  (ev) => {
    if (/FROM|WITH/i.test(ev.query) && !/^(BEGIN|COMMIT|SELECT 1)/.test(ev.query))
      capturadas.push({ query: ev.query, params: ev.params });
  },
);

async function explicar(titulo: string, fn: () => Promise<unknown>) {
  capturadas.length = 0;
  await fn();
  const q = capturadas.find((c) => /ResumenDiario|VentaItem/.test(c.query)) ?? capturadas.at(-1)!;
  const params = JSON.parse(q.params) as unknown[];
  const plan = await prisma.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
    `EXPLAIN (ANALYZE, BUFFERS) ${q.query}`,
    ...params,
  );
  const texto = plan.map((p) => p["QUERY PLAN"]);
  const ms = Number(texto.find((l) => l.startsWith("Execution Time"))?.match(/[\d.]+/)?.[0] ?? NaN);
  console.log(`\n=== ${titulo} ===\n${texto.join("\n")}`);
  console.log(`--> ${ms < 50 ? "✔" : "✘"} ${ms} ms (objetivo < 50 ms)`);
  return ms;
}

async function main() {
  if (process.env.PRISMA_LOG !== "query") throw new Error("Correr con PRISMA_LOG=query");
  const tz = await obtenerZonaHoraria();
  const hoy = diaEn(ahora(), tz);
  const noventa = { desde: sumarDias(hoy, -89), hasta: hoy };
  const [ventas, items, resumen] = await Promise.all([
    prisma.venta.count(),
    prisma.ventaItem.count(),
    prisma.resumenDiario.count(),
  ]);
  console.log(
    `Datos: ${ventas} ventas, ${items} ítems, ${resumen} filas de ResumenDiario. Rango: ${noventa.desde} → ${noventa.hasta}`,
  );
  const tiempos = [
    await explicar(
      "Serie temporal diaria, 90 días (dashboard / reporte de ventas) — sobre ResumenDiario",
      () => serieTemporal({ ...noventa, granularidad: "dia" }),
    ),
    await explicar(
      "Ranking de variantes por ganancia, 90 días (neto de devoluciones, descuento prorrateado)",
      () => rankingVariantes({ ...noventa, orden: "ganancia", limit: 10 }),
    ),
  ];
  process.exitCode = tiempos.every((t) => t < 50) ? 0 : 1;
}

main().finally(() => prisma.$disconnect());
