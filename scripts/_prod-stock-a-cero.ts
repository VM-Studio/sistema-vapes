/**
 * Producción (2026-11-09): pone en 0 el stock de TODOS los productos de todos
 * los paneles, para que el dueño lo vuelva a cargar con su costo (v2.9.1).
 * No borra nada: por cada galpón genera un recuento (registrarAjusteMasivo)
 * con cantidad real 0 → un AJUSTE_NEGATIVO por sabor con stock. Productos,
 * sabores, precios, costos y el historial de movimientos quedan intactos.
 *
 * Sin --aplicar solo muestra lo que haría. Con --aplicar, antes de tocar nada
 * guarda un CSV con el stock actual en ~/backups-sistema-vapes/.
 *
 * Uso (con DATABASE_URL/DIRECT_URL de producción en el entorno):
 *   pnpm tsx --env-file=<prod.env> --conditions=react-server scripts/_prod-stock-a-cero.ts [--aplicar]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { RolUsuario } from "@prisma/client";

import { prisma } from "../src/lib/db";
import { dbPara } from "../src/server/db/panel-scoped";
import { registrarAjusteMasivo } from "../src/server/services/movimiento.service";

const APLICAR = process.argv.includes("--aplicar");
const MOTIVO = "Stock a 0 para volver a cargarlo con su costo";

const csv = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://?/").hostname;
  console.log(`Base: ${host} · modo ${APLICAR ? "APLICAR" : "solo mirar (sin --aplicar)"}\n`);

  const actor = await prisma.usuario.findFirst({
    where: { rol: RolUsuario.OWNER, activo: true, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, nombre: true },
  });
  if (!actor) throw new Error("No hay un dueño activo para firmar los ajustes.");

  const paneles = await prisma.panel.findMany({ select: { id: true, nombre: true, slug: true } });
  const filasCsv: string[] = [
    ["panel", "galpon", "producto", "sabor", "cantidad", "ultimoCosto", "varianteId", "depositoId"]
      .map(csv)
      .join(","),
  ];
  const plan: {
    panelId: string;
    depositoId: string;
    galpon: string;
    panel: string;
    varianteIds: string[];
    unidades: number;
  }[] = [];

  for (const p of paneles) {
    const db = dbPara(p.id);
    const ventas = await db.venta.count();
    const filas = await db.stock.findMany({
      where: { cantidad: { not: 0 } },
      select: {
        cantidad: true,
        depositoId: true,
        varianteId: true,
        deposito: { select: { nombre: true, activo: true } },
        variante: {
          select: {
            nombre: true,
            ultimoCosto: true,
            deletedAt: true,
            producto: { select: { nombreCompleto: true, deletedAt: true } },
          },
        },
      },
      orderBy: [{ depositoId: "asc" }, { varianteId: "asc" }],
    });
    const unidades = filas.reduce((a, f) => a + f.cantidad, 0);
    console.log(
      `Panel ${p.nombre} (${p.slug}): ${filas.length} sabores con stock, ${unidades} unidades · ventas registradas: ${ventas}`,
    );
    const porDeposito = new Map<string, typeof filas>();
    for (const f of filas) {
      filasCsv.push(
        [
          p.slug,
          f.deposito.nombre,
          f.variante.producto.nombreCompleto,
          f.variante.nombre ?? "",
          f.cantidad,
          f.variante.ultimoCosto?.toFixed(2) ?? "",
          f.varianteId,
          f.depositoId,
        ]
          .map(csv)
          .join(","),
      );
      console.log(
        `   ${f.deposito.nombre.padEnd(14)} ${String(f.cantidad).padStart(5)}  ${f.variante.producto.nombreCompleto}${f.variante.nombre ? ` — ${f.variante.nombre}` : ""}`,
      );
      if (f.variante.deletedAt || f.variante.producto.deletedAt || !f.deposito.activo) {
        console.log("      ⚠ sabor/producto borrado o galpón inactivo: no se ajusta");
        continue;
      }
      porDeposito.set(f.depositoId, [...(porDeposito.get(f.depositoId) ?? []), f]);
    }
    for (const [depositoId, fs] of porDeposito)
      plan.push({
        panelId: p.id,
        panel: p.nombre,
        depositoId,
        galpon: fs[0]!.deposito.nombre,
        varianteIds: fs.map((f) => f.varianteId),
        unidades: fs.reduce((a, f) => a + f.cantidad, 0),
      });
  }

  const total = plan.reduce((a, x) => a + x.unidades, 0);
  console.log(`\nTotal a poner en 0: ${total} unidades en ${plan.length} galpón(es).`);
  if (!APLICAR) {
    console.log("Nada se modificó. Para aplicarlo, repetí con --aplicar.");
    return;
  }
  if (plan.length === 0) {
    console.log("No hay stock para poner en 0.");
    return;
  }

  const dir = path.join(homedir(), "backups-sistema-vapes");
  await mkdir(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const archivo = path.join(dir, `prod-pre-stock-cero-${ts}.csv`);
  await writeFile(archivo, filasCsv.join("\n") + "\n");
  console.log(`Backup del stock actual: ${archivo}`);

  for (const x of plan) {
    const r = await registrarAjusteMasivo(
      { panelId: x.panelId, usuarioId: actor.id },
      {
        depositoId: x.depositoId,
        motivo: MOTIVO,
        items: x.varianteIds.map((varianteId) => ({ varianteId, cantidadReal: 0 })),
      },
    );
    console.log(
      `✔ ${x.panel} / ${x.galpon}: ${r.ajustes.length} sabores en 0 (recuento ${r.referenciaId})`,
    );
  }

  for (const p of paneles) {
    const resto = await dbPara(p.id).stock.aggregate({ _sum: { cantidad: true } });
    console.log(`Stock que queda en ${p.nombre}: ${resto._sum.cantidad ?? 0}`);
  }
  console.log(`Ajustes firmados por ${actor.nombre}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
