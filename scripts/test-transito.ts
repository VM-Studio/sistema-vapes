/**
 * Stock en tránsito (v2.14.0), panel Cosmetic: Casa → Mercado Libre Full.
 *  1. «Enviar» a Mercado Libre: sale de Casa en el momento, queda «en
 *     tránsito» (no está en ningún depósito), el resumen y las filas de stock
 *     lo muestran; no se puede vender lo que ya salió.
 *  2. «Llegó»: entra a Mercado Libre y deja de estar en tránsito.
 *  3. Anular un envío en tránsito: vuelve a Casa.
 *  4. Sin stock suficiente en Casa → error y no se mueve nada.
 *  5. Un depósito SIN tránsito (Vapes Ayres → Mercedes) sigue igual: el
 *     envío pendiente no mueve stock.
 * Uso: scripts/db-descartable.sh gestion_test && DATABASE_URL=…/gestion_test pnpm test:transito
 */
import { RolUsuario } from "@prisma/client";

import { prisma } from "../src/lib/db";
import { crearTransferenciaSchema } from "../src/lib/validations/transferencia";
import { dbPara, transaccion, type Ctx } from "../src/server/db/panel-scoped";
import { DomainError } from "../src/server/errors";
import { obtenerStock, filtrosStockSchema } from "../src/server/services/inventario.service";
import { registrarAjuste } from "../src/server/services/movimiento.service";
import { resumenStock } from "../src/server/services/stock.service";
import {
  anularTransferencia,
  completarTransferencia,
  registrarEnvioTransferencia,
} from "../src/server/services/transferencia.service";

const COSMETIC = "pnl_cosmetic";
const VAPES = "pnl_vapes";

let fallos = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) fallos++;
  console.log(`  ${cond ? "✔" : "✘"} ${msg}`);
};
async function error(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

async function main() {
  const base = new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, "");
  if (!base || base === "gestion")
    throw new Error(`test-transito crea datos: usá una base descartable ("${base}").`);
  console.log(`Base: ${base}`);
  const owner = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.OWNER, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  const meta = { ip: "127.0.0.1", userAgent: "test-transito" };
  const ctx: Ctx = { panelId: COSMETIC, usuarioId: owner.id, meta };
  const db = dbPara(COSMETIC);
  const casa = await db.deposito.findFirstOrThrow({ where: { nombre: "Casa" } });
  const ml = await db.deposito.findFirstOrThrow({ where: { nombre: "Mercado Libre" } });
  check(
    casa.esPrincipal && ml.conTransito,
    "Cosmetic: Casa (principal) y Mercado Libre (tránsito)",
  );

  const suf = String(Date.now()).slice(-7);
  const variante = await transaccion(ctx, async (tx) => {
    const marca = await tx.marca.upsert({
      where: { panelId_nombre: { panelId: COSMETIC, nombre: "Test Tránsito" } },
      update: {},
      create: { nombre: "Test Tránsito" },
    });
    const p = await tx.producto.create({
      data: {
        marcaId: marca.id,
        nombre: `Serum ${suf}`,
        especificacion: "30 ml",
        precioVenta: "9000.00",
        variantes: { create: [{ nombre: "Único", sku: `TT-${suf}`, ultimoCostoUsdt: "3.00" }] },
      },
      include: { variantes: true },
    });
    return p.variantes[0]!;
  });
  await registrarAjuste(ctx, {
    depositoId: casa.id,
    varianteId: variante.id,
    cantidadReal: 30,
    motivo: "Preparación test-transito",
  });
  const en = async (depositoId: string) =>
    (await db.stock.findFirst({ where: { varianteId: variante.id, depositoId } }))?.cantidad ?? 0;
  const fila = async () =>
    (await obtenerStock(ctx, filtrosStockSchema.parse({ q: `TT-${suf}` }))).filas.find(
      (f) => f.varianteId === variante.id,
    );
  const envio = (cantidad: number) =>
    registrarEnvioTransferencia(
      ctx,
      crearTransferenciaSchema.parse({
        depositoOrigenId: casa.id,
        depositoDestinoId: ml.id,
        items: [{ varianteId: variante.id, cantidad }],
      }),
    );

  // ---------------------------------------------------------------------------
  console.log("\n1) Enviar 12 a Mercado Libre");
  const t1 = await envio(12);
  const fila1 = await db.transferencia.findUniqueOrThrow({ where: { id: t1.id } });
  check(fila1.estado === "PENDIENTE" && fila1.enTransito, "queda PENDIENTE y en tránsito");
  check((await en(casa.id)) === 18 && (await en(ml.id)) === 0, "Casa 18 · Mercado Libre 0");
  const f1 = await fila();
  check(f1?.enTransito === 12, `fila de stock: ${f1?.enTransito} en tránsito`);
  const r1 = await resumenStock(ctx);
  check(
    r1.enTransito.unidades === 12 &&
      r1.enTransito.envios === 1 &&
      r1.enTransito.destinos.join() === "Mercado Libre",
    `resumen: ${r1.enTransito.unidades} unidades en ${r1.enTransito.envios} envío a ${r1.enTransito.destinos.join()}`,
  );
  const movs1 = await db.movimientoStock.findMany({ where: { referenciaId: t1.id } });
  check(
    movs1.length === 1 && movs1[0]!.tipo === "TRANSFERENCIA_SALIDA",
    "un movimiento: SALIDA de Casa",
  );

  // ---------------------------------------------------------------------------
  console.log("\n2) Llegó a Mercado Libre");
  const c = await completarTransferencia(ctx, t1.id);
  check(c.unidades === 12, "completa 12 unidades");
  check((await en(casa.id)) === 18 && (await en(ml.id)) === 12, "Casa 18 · Mercado Libre 12");
  const fila2 = await db.transferencia.findUniqueOrThrow({ where: { id: t1.id } });
  check(fila2.estado === "COMPLETADA" && !fila2.enTransito, "COMPLETADA y ya no en tránsito");
  check((await resumenStock(ctx)).enTransito.unidades === 0, "resumen: 0 en tránsito");
  const dos = await error(() => completarTransferencia(ctx, t1.id));
  check(dos instanceof DomainError && (await en(ml.id)) === 12, "no se completa dos veces");

  // ---------------------------------------------------------------------------
  console.log("\n3) Anular un envío en tránsito");
  const t3 = await envio(5);
  check((await en(casa.id)) === 13, "Casa 13 (salieron 5)");
  await anularTransferencia(ctx, t3.id, "Se canceló el envío");
  const fila3 = await db.transferencia.findUniqueOrThrow({ where: { id: t3.id } });
  check(
    fila3.estado === "ANULADA" && !fila3.enTransito && (await en(casa.id)) === 18,
    "ANULADA y vuelve a Casa (18)",
  );
  check((await en(ml.id)) === 12, "Mercado Libre sin cambios (12)");

  // ---------------------------------------------------------------------------
  console.log("\n4) Sin stock suficiente");
  const sinStock = await error(() => envio(50));
  check(sinStock instanceof DomainError, `enviar 50 con 18 en Casa → error`);
  check((await en(casa.id)) === 18, "Casa sigue en 18");

  // ---------------------------------------------------------------------------
  console.log("\n5) Sin tránsito (Vapes) sigue igual");
  const ctxV: Ctx = { panelId: VAPES, usuarioId: owner.id, meta };
  const dbV = dbPara(VAPES);
  const ayres = await dbV.deposito.findFirstOrThrow({ where: { esPrincipal: true } });
  const merc = await dbV.deposito.findFirstOrThrow({ where: { nombre: "Mercedes" } });
  const vV = await transaccion(ctxV, async (tx) => {
    const marca = await tx.marca.upsert({
      where: { panelId_nombre: { panelId: VAPES, nombre: "Test Tránsito V" } },
      update: {},
      create: { nombre: "Test Tránsito V" },
    });
    const p = await tx.producto.create({
      data: {
        marcaId: marca.id,
        nombre: `Pod TT ${suf}`,
        especificacion: "6000",
        precioVenta: "10000.00",
        variantes: { create: [{ nombre: "Menta", sku: `TTV-${suf}`, ultimoCostoUsdt: "2.50" }] },
      },
      include: { variantes: true },
    });
    return p.variantes[0]!;
  });
  await registrarAjuste(ctxV, {
    depositoId: ayres.id,
    varianteId: vV.id,
    cantidadReal: 10,
    motivo: "Preparación test-transito",
  });
  const tv = await registrarEnvioTransferencia(
    ctxV,
    crearTransferenciaSchema.parse({
      depositoOrigenId: ayres.id,
      depositoDestinoId: merc.id,
      items: [{ varianteId: vV.id, cantidad: 4 }],
    }),
  );
  const filaV = await dbV.transferencia.findUniqueOrThrow({ where: { id: tv.id } });
  const ayresCant = (
    await dbV.stock.findFirst({ where: { varianteId: vV.id, depositoId: ayres.id } })
  )?.cantidad;
  check(!filaV.enTransito && ayresCant === 10, "Ayres → Mercedes pendiente: no mueve stock (10)");
  await completarTransferencia(ctxV, tv.id);
  const mercCant = (
    await dbV.stock.findFirst({ where: { varianteId: vV.id, depositoId: merc.id } })
  )?.cantidad;
  check(mercCant === 4, "al confirmar se mueve como siempre (Mercedes 4)");

  console.log(fallos === 0 ? "\nTodo OK" : `\n${fallos} chequeo(s) fallaron`);
  if (fallos > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
