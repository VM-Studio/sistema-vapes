/**
 * Concurrencia de ventas en el panel Vapes (crea datos: correr sobre una base
 * recién sembrada).
 *  1. 10 generarVenta SIMULTÁNEAS de 1 unidad de un sabor con stock 5 →
 *     exactamente 5 confirman, 5 fallan por stock, stock 0.
 *  2. Los códigos de las confirmadas son consecutivos y sin huecos: las que
 *     fallan no consumen número.
 *  3. 10 ventas simultáneas de sabores distintos (con stock) → todas confirman,
 *     números únicos y consecutivos; otro panel no se ve afectado.
 * Uso: pnpm test:ventas:concurrencia
 */
import { EstadoVenta, RolUsuario } from "@prisma/client";

import { prisma } from "../src/lib/db";
import { formatearIdVenta } from "../src/lib/paneles";
import { generarVentaSchema } from "../src/lib/validations/venta";
import { dbPara, type Ctx } from "../src/server/db/panel-scoped";
import { crearCliente } from "../src/server/services/cliente.service";
import { registrarAjuste } from "../src/server/services/movimiento.service";
import { generarVenta } from "../src/server/services/venta.service";

const PANEL = "pnl_vapes";
const db = dbPara(PANEL);

let fallos = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) fallos++;
  console.log(`  ${cond ? "✔" : "✘"} ${msg}`);
};

const ultimoNumero = async (panelId: string) =>
  (
    await prisma.secuencia.findUniqueOrThrow({
      where: { panelId_entidad: { panelId, entidad: "VENTA" } },
    })
  ).ultimoNumero;

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));
const consecutivos = (ns: number[]) => {
  const o = [...ns].sort((a, b) => a - b);
  return o.every((n, i) => i === 0 || n === o[i - 1]! + 1);
};

async function main() {
  const owner = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.OWNER, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  const ctx: Ctx = {
    panelId: PANEL,
    usuarioId: owner.id,
    meta: { ip: "127.0.0.1", userAgent: "test-ventas-concurrentes" },
  };
  const deposito = await db.deposito.findFirstOrThrow({ where: { esPrincipal: true } });
  const variante = await db.variante.findFirstOrThrow({
    where: { nombre: "Grape Ice", producto: { nombre: "V80", marca: { nombre: "Ignite" } } },
    include: { producto: { select: { nombreCompleto: true } } },
  });
  const suf = String(Date.now()).slice(-6);
  const cliente = await crearCliente(ctx, {
    nombre: "Cliente concurrencia",
    telefono: `11${suf}${Math.floor(Math.random() * 90) + 10}`,
  });
  const stockDe = async (varianteId: string) =>
    (await db.stock.findFirst({ where: { varianteId, depositoId: deposito.id } }))?.cantidad ?? 0;
  const dejarStock = async (varianteId: string, cantidadReal: number) => {
    if ((await stockDe(varianteId)) === cantidadReal) return;
    await registrarAjuste(ctx, {
      depositoId: deposito.id,
      varianteId,
      cantidadReal,
      motivo: "Prueba de concurrencia",
    });
  };
  const venta = (varianteId: string) =>
    generarVenta(
      ctx,
      generarVentaSchema.parse({
        depositoId: deposito.id,
        cliente: { id: cliente.id },
        items: [{ varianteId, cantidad: 1 }],
        medioPago: "EFECTIVO",
      }),
      { puedeEditar: false },
    );

  // ---------------------------------------------------------------------------
  console.log(
    `\n1) ${variante.producto.nombreCompleto} — ${variante.nombre} con stock 5 en ${deposito.nombre}: 10 ventas simultáneas`,
  );
  await dejarStock(variante.id, 5);
  check((await stockDe(variante.id)) === 5, "stock inicial 5");
  const numeroAntes = await ultimoNumero(PANEL);
  const cosmeticAntes = await ultimoNumero("pnl_cosmetic");

  const t0 = performance.now();
  const resultados = await Promise.allSettled(Array.from({ length: 10 }, () => venta(variante.id)));
  const ms = Math.round(performance.now() - t0);
  const ok = resultados.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const errores = resultados.flatMap((r) => (r.status === "rejected" ? [mensaje(r.reason)] : []));
  const otros = errores.filter((e) => !/^No hay stock de /.test(e));
  check(ok.length === 5, `${ok.length} confirmadas (en ${ms} ms)`);
  check(
    errores.length === 5 && otros.length === 0,
    `${errores.length} rechazadas por stock: «${errores[0]}»${otros.length ? ` · OTROS: ${otros.join(" | ")}` : ""}`,
  );
  check((await stockDe(variante.id)) === 0, "stock final 0 (nunca negativo)");

  // ---------------------------------------------------------------------------
  console.log("\n2) Códigos consecutivos, sin huecos ni repetidos");
  const numeros = ok.map((v) => v.numero);
  check(
    new Set(numeros).size === 5 && consecutivos(numeros),
    `números ${[...numeros].sort((a, b) => a - b).join(", ")}`,
  );
  check(
    Math.min(...numeros) === numeroAntes + 1 && (await ultimoNumero(PANEL)) === numeroAntes + 5,
    `la secuencia avanzó exactamente 5 (${numeroAntes} → ${await ultimoNumero(PANEL)})`,
  );
  check(
    ok.every((v) => v.codigo === formatearIdVenta("vapes", v.numero)),
    `códigos ${ok
      .map((v) => v.codigo)
      .sort()
      .join(", ")}`,
  );
  const movimientos = await db.movimientoStock.count({
    where: { referenciaTipo: "VENTA", referenciaId: { in: ok.map((v) => v.id) } },
  });
  check(movimientos === 5, "un movimiento VENTA por venta confirmada");
  const huerfanos = await db.venta.count({
    where: {
      numero: { gt: numeroAntes },
      estado: EstadoVenta.CONFIRMADA,
      id: { notIn: ok.map((v) => v.id) },
    },
  });
  check(huerfanos === 0, "ninguna venta de más");

  // ---------------------------------------------------------------------------
  console.log("\n3) 10 ventas simultáneas de sabores distintos (con stock)");
  const sabores = await db.variante.findMany({
    where: { deletedAt: null, activo: true, producto: { activo: true, deletedAt: null } },
    orderBy: { id: "asc" },
    take: 10,
  });
  for (const s of sabores) if ((await stockDe(s.id)) < 2) await dejarStock(s.id, 5);
  const antes3 = await ultimoNumero(PANEL);
  const r3 = await Promise.allSettled(sabores.map((s) => venta(s.id)));
  const ok3 = r3.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const err3 = r3.flatMap((r) => (r.status === "rejected" ? [mensaje(r.reason)] : []));
  check(
    ok3.length === sabores.length,
    `${ok3.length}/${sabores.length} confirmadas${err3.length ? ` · ${err3.join(" | ")}` : ""}`,
  );
  check(
    consecutivos(ok3.map((v) => v.numero)) &&
      new Set(ok3.map((v) => v.numero)).size === ok3.length &&
      (await ultimoNumero(PANEL)) === antes3 + ok3.length,
    "números únicos y consecutivos",
  );
  check(
    (await ultimoNumero("pnl_cosmetic")) === cosmeticAntes,
    "la numeración de Cosmetic no se tocó",
  );

  console.log(fallos ? `\n✘ ${fallos} verificaciones fallaron` : "\n✔ Todo OK");
  process.exitCode = fallos ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
