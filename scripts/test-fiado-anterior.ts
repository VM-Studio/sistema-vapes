/**
 * Fiados anteriores al sistema (v2.14.0) a nivel servicios + DB, panel Vapes:
 *  1. Cargar un fiado anterior (cliente existente y cliente nuevo): suma a
 *     saldoDeudor, aparece en /fiados, en la cuenta corriente y en el resumen.
 *     No es una venta: no crea Venta ni mueve stock.
 *  2. Fecha futura / monto 0 / sin permiso → error.
 *  3. Un cobro que cubre fiado anterior + venta fiada: primero el más viejo,
 *     mismo cobroId, recibo con las dos imputaciones, «cobrado del mes».
 *  4. Anular el cobro: vuelven a deberse los dos.
 *  5. Anular el fiado anterior: con cobros → error; sin cobros → baja la deuda;
 *     un empleado no puede; no se puede anular dos veces.
 *  6. Invariante: saldoDeudor = Σ ventas + Σ fiados anteriores (el trigger lo exige).
 * Uso: scripts/db-descartable.sh gestion_test && DATABASE_URL=…/gestion_test pnpm test:fiado-anterior
 */
import { EstadoFiadoAnterior, Prisma, RolUsuario } from "@prisma/client";

import { prisma } from "../src/lib/db";
import { fijarReloj } from "../src/lib/reloj";
import { generarVentaSchema } from "../src/lib/validations/venta";
import { dbPara, transaccion, type Ctx } from "../src/server/db/panel-scoped";
import { DomainError, ForbiddenError } from "../src/server/errors";
import { crearCliente } from "../src/server/services/cliente.service";
import {
  anularFiadoAnterior,
  cargarFiadoAnterior,
} from "../src/server/services/fiado-anterior.service";
import {
  anularCobro,
  cuentaCorriente,
  deudores,
  puedeFiados,
  registrarCobro,
  resumenFiados,
} from "../src/server/services/fiado.service";
import { registrarAjuste } from "../src/server/services/movimiento.service";
import { obtenerReciboCobro } from "../src/server/services/recibo-cobro.service";
import { generarVenta } from "../src/server/services/venta.service";

const VAPES = "pnl_vapes";
const db = dbPara(VAPES);
const DIA = 24 * 3600 * 1000;

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
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const $ = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n).toFixed(2);

async function main() {
  const base = new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, "");
  if (!base || base === "gestion")
    throw new Error(`test-fiado-anterior crea datos: usá una base descartable ("${base}").`);
  console.log(`Base: ${base}`);
  const owner = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.OWNER, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  const empleado = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.EMPLEADO, deletedAt: null, paneles: { some: { panelId: VAPES } } },
    orderBy: { createdAt: "asc" },
  });
  const meta = { ip: "127.0.0.1", userAgent: "test-fiado-anterior" };
  const ctx: Ctx = { panelId: VAPES, usuarioId: owner.id, meta };
  const ctxEmp: Ctx = { panelId: VAPES, usuarioId: empleado.id, meta };

  const g1 = await db.deposito.findFirstOrThrow({ where: { esPrincipal: true } });
  const suf = String(Date.now()).slice(-7);
  const variante = await transaccion(ctx, async (tx) => {
    const marca = await tx.marca.upsert({
      where: { panelId_nombre: { panelId: VAPES, nombre: "Test FA" } },
      update: {},
      create: { nombre: "Test FA" },
    });
    const p = await tx.producto.create({
      data: {
        marcaId: marca.id,
        nombre: `Pod FA ${suf}`,
        especificacion: "6000",
        precioVenta: "10000.00",
        variantes: { create: [{ nombre: "Uva", sku: `TFA-${suf}`, ultimoCostoUsdt: "2.50" }] },
      },
      include: { variantes: true },
    });
    return p.variantes[0]!;
  });
  await registrarAjuste(ctx, {
    depositoId: g1.id,
    varianteId: variante.id,
    cantidadReal: 20,
    motivo: "Preparación test-fiado-anterior",
  });
  const stockDe = async () =>
    (
      await db.stock.findFirstOrThrow({
        where: { varianteId: variante.id, depositoId: g1.id },
      })
    ).cantidad;
  const saldoDe = async (id: string) =>
    $((await db.cliente.findUniqueOrThrow({ where: { id } })).saldoDeudor);
  const mes = { desde: new Date(Date.now() - 20 * DIA), hasta: new Date(Date.now() + DIA) };

  // ---------------------------------------------------------------------------
  console.log("\n1) Cargar fiado anterior");
  const c1 = await crearCliente(ctx, {
    nombre: `Deudor viejo ${suf}`,
    telefono: `11${suf}1`,
    origenId: owner.id,
  });
  const ventasAntes = await db.venta.count();
  const stockAntes = await stockDe();
  const resumenAntes = await resumenFiados(ctx, mes);
  const hace60 = new Date(Date.now() - 60 * DIA).toISOString().slice(0, 10);
  const fa = await cargarFiadoAnterior(ctx, {
    cliente: { id: c1.id },
    monto: 15000,
    fecha: hace60,
    concepto: "Cuenta de agosto",
  });
  check(/^VAP-FA-\d{6}$/.test(fa.codigo), `código ${fa.codigo}`);
  check((await saldoDe(c1.id)) === "15000.00", `saldoDeudor ${await saldoDe(c1.id)}`);
  check((await db.venta.count()) === ventasAntes, "no crea ninguna venta");
  check((await stockDe()) === stockAntes, "no mueve stock");
  const lista = await deudores(ctx, { page: 1, q: `Deudor viejo ${suf}` });
  const d1 = lista.deudores.find((d) => d.id === c1.id);
  check(
    !!d1 && d1.saldo === "15000.00" && d1.ventasPendientes === 1 && (d1.diasAntiguedad ?? 0) >= 59,
    `/fiados: debe ${d1?.saldo}, ${d1?.ventasPendientes} pendiente, ${d1?.diasAntiguedad} días`,
  );
  check(
    Number(d1?.deuda.usdt) > 0,
    `deuda en USDT ${d1?.deuda.usdt} (a la cotización del día de carga)`,
  );
  const cc1 = await cuentaCorriente(ctx, c1.id);
  const mov = cc1.movimientos.find((m) => m.tipo === "VENTA");
  check(
    cc1.movimientos.length === 1 &&
      mov?.tipo === "VENTA" &&
      mov.fiadoAnterior?.concepto === "Cuenta de agosto" &&
      mov.saldoAcumulado === "15000.00",
    "cuenta corriente: un movimiento «fiado anterior» con su concepto y saldo",
  );
  check(
    cc1.pendientes.length === 1 && cc1.pendientes[0]!.fiadoAnterior !== null,
    "pendientes: el fiado anterior",
  );
  const resumen1 = await resumenFiados(ctx, mes);
  check(
    $(D(resumen1.porCobrar.pesos).minus(resumenAntes.porCobrar.pesos)) === "15000.00",
    `«Por cobrar» sube $15.000 (${resumenAntes.porCobrar.pesos} → ${resumen1.porCobrar.pesos})`,
  );
  check(
    resumen1.fiadoPeriodo.pesos === resumenAntes.fiadoPeriodo.pesos,
    "«Fiado este mes» no cambia (no es una venta del mes)",
  );

  const nuevo = await cargarFiadoAnterior(ctx, {
    cliente: {
      nuevo: { nombre: `Cliente nuevo FA ${suf}`, telefono: `11${suf}2`, origenId: owner.id },
    },
    monto: 2500.5,
    fecha: undefined,
    concepto: undefined,
  });
  check(
    nuevo.clienteNuevo && (await saldoDe(nuevo.cliente.id)) === "2500.50",
    `cliente nuevo dado de alta con la deuda (${await saldoDe(nuevo.cliente.id)})`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n2) Validaciones");
  const manana = new Date(Date.now() + 2 * DIA).toISOString().slice(0, 10);
  const futuro = await error(() =>
    cargarFiadoAnterior(ctx, {
      cliente: { id: c1.id },
      monto: 100,
      fecha: manana,
      concepto: undefined,
    }),
  );
  check(futuro instanceof DomainError, `fecha futura → error («${msg(futuro)}»)`);
  const cero = await error(() =>
    cargarFiadoAnterior(ctx, {
      cliente: { id: c1.id },
      monto: 0,
      fecha: undefined,
      concepto: undefined,
    }),
  );
  check(cero instanceof DomainError, "monto 0 → error");
  if (!(await puedeFiados(ctxEmp, "crear"))) {
    const sinPermiso = await error(() =>
      cargarFiadoAnterior(ctxEmp, {
        cliente: { id: c1.id },
        monto: 100,
        fecha: undefined,
        concepto: undefined,
      }),
    );
    check(sinPermiso instanceof ForbiddenError, "empleado sin FIADOS «crear» → no puede cargar");
  }
  check((await saldoDe(c1.id)) === "15000.00", "saldo intacto después de los errores");

  // ---------------------------------------------------------------------------
  console.log("\n3) Un cobro que cubre el fiado anterior y una venta fiada");
  // Venta fiada de hace 10 días (más nueva que el fiado anterior).
  const hace10 = new Date(Date.now() - 10 * DIA);
  fijarReloj(() => hace10);
  const v = await generarVenta(
    ctx,
    generarVentaSchema.parse({
      depositoId: g1.id,
      cliente: { id: c1.id },
      items: [{ varianteId: variante.id, cantidad: 1 }],
      pagos: [],
      fiar: true,
    }),
    { puedeEditar: true },
  );
  fijarReloj(null);
  check((await saldoDe(c1.id)) === "25000.00", `debe 15.000 + 10.000 = ${await saldoDe(c1.id)}`);
  const cobradoAntes = (await resumenFiados(ctx, mes)).cobradoPeriodo.pesos;
  const cobro = await registrarCobro(ctx, {
    clienteId: c1.id,
    monto: 20000,
    medioPago: "EFECTIVO",
  });
  check(
    cobro.imputaciones.length === 2 &&
      cobro.imputaciones[0]!.codigo === fa.codigo &&
      cobro.imputaciones[0]!.monto === "15000.00" &&
      cobro.imputaciones[1]!.monto === "5000.00",
    `imputa primero el fiado anterior (${cobro.imputaciones.map((i) => `${i.codigo} ${i.monto}`).join(", ")})`,
  );
  check(cobro.saldoRestante === "5000.00", `saldo restante ${cobro.saldoRestante}`);
  const filaFa = await db.fiadoAnterior.findUniqueOrThrow({ where: { id: fa.id } });
  check(
    $(filaFa.saldoPendiente) === "0.00" && $(filaFa.montoPagado) === "15000.00",
    "fiado anterior saldado",
  );
  const pagosFa = await db.pagoFiadoAnterior.findMany({ where: { fiadoId: fa.id } });
  const pagosV = await db.pagoVenta.findMany({ where: { ventaId: v.id, esCobroPosterior: true } });
  check(
    pagosFa.length === 1 && pagosV.length === 1 && pagosFa[0]!.cobroId === pagosV[0]!.cobroId,
    "un pago en cada tabla, con el mismo cobroId",
  );
  const recibo = await obtenerReciboCobro(ctx, cobro.cobroId);
  check(
    recibo.monto === "20000.00" && recibo.imputaciones.length === 2,
    `recibo: $${recibo.monto} en ${recibo.imputaciones.length} imputaciones`,
  );
  const cobradoDespues = (await resumenFiados(ctx, mes)).cobradoPeriodo.pesos;
  check(
    $(D(cobradoDespues).minus(cobradoAntes)) === "20000.00",
    `«Cobrado este mes» suma los $20.000 (${cobradoAntes} → ${cobradoDespues})`,
  );
  const cc3 = await cuentaCorriente(ctx, c1.id);
  const ultimo = cc3.movimientos.at(-1)!;
  check(
    ultimo.tipo === "COBRO" &&
      ultimo.imputaciones.length === 2 &&
      ultimo.saldoAcumulado === "5000.00",
    `cuenta corriente: cobro con 2 imputaciones, saldo ${ultimo.saldoAcumulado}`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n4) Anular el cobro");
  const anularConCobro = await error(() => anularFiadoAnterior(ctx, fa.id, "Prueba"));
  check(
    anularConCobro instanceof DomainError,
    `anular el fiado con cobros → error («${msg(anularConCobro).slice(0, 60)}»)`,
  );
  // Se anula desde el pago del fiado anterior (también anula el de la venta).
  const r = await anularCobro(ctx, pagosFa[0]!.id, "Se cargó mal");
  check(r.monto === "20000.00", `anula los $${r.monto} del cobro completo`);
  check((await saldoDe(c1.id)) === "25000.00", `vuelve a deber ${await saldoDe(c1.id)}`);
  const filaFa2 = await db.fiadoAnterior.findUniqueOrThrow({ where: { id: fa.id } });
  check($(filaFa2.saldoPendiente) === "15000.00", "el fiado anterior vuelve a deberse entero");
  check((await obtenerReciboCobro(ctx, cobro.cobroId)).anulado, "el recibo dice «anulado»");

  // ---------------------------------------------------------------------------
  console.log("\n5) Anular el fiado anterior");
  const emp = await error(() => anularFiadoAnterior(ctxEmp, fa.id, "No corresponde"));
  check(emp instanceof ForbiddenError, "un empleado no puede anularlo");
  await anularFiadoAnterior(ctx, fa.id, "Ya lo había pagado");
  const filaFa3 = await db.fiadoAnterior.findUniqueOrThrow({ where: { id: fa.id } });
  check(
    filaFa3.estado === EstadoFiadoAnterior.ANULADO && (await saldoDe(c1.id)) === "10000.00",
    `anulado: queda la venta (${await saldoDe(c1.id)})`,
  );
  const dos = await error(() => anularFiadoAnterior(ctx, fa.id, "Otra vez"));
  check(dos instanceof DomainError, "no se anula dos veces");
  const cc5 = await cuentaCorriente(ctx, c1.id);
  const movFa = cc5.movimientos.find((m) => m.tipo === "VENTA" && m.fiadoAnterior);
  check(
    movFa?.tipo === "VENTA" && movFa.fiadoAnterior!.anulado && cc5.pendientes.length === 1,
    "cuenta corriente: el fiado queda a la vista como anulado y no está en pendientes",
  );
  check(cc5.movimientos.at(-1)!.saldoAcumulado === "10000.00", "saldo final de la cuenta 10.000");
  const borrar = await error(() => prisma.fiadoAnterior.delete({ where: { id: fa.id } }));
  check(borrar !== null, "la base no deja borrar un fiado anterior");

  // ---------------------------------------------------------------------------
  console.log("\n6) Invariante");
  const [inv] = await prisma.$queryRaw<{ mal: number }[]>`
    SELECT COUNT(*)::int AS mal FROM "Cliente" c
    WHERE c."saldoDeudor" <>
      COALESCE((SELECT SUM(v."saldoPendiente") FROM "Venta" v
        WHERE v."clienteId" = c."id" AND v."estado" = 'CONFIRMADA'), 0)
      + COALESCE((SELECT SUM(f."saldoPendiente") FROM "FiadoAnterior" f
        WHERE f."clienteId" = c."id" AND f."estado" = 'VIGENTE'), 0)`;
  check(inv!.mal === 0, "saldoDeudor = Σ ventas + Σ fiados anteriores en todos los clientes");
  const romper = await error(() =>
    prisma.cliente.update({ where: { id: c1.id }, data: { saldoDeudor: { increment: 1 } } }),
  );
  check(romper !== null, "el trigger rechaza un saldoDeudor que no cierra");

  console.log(fallos === 0 ? "\nTodo OK" : `\n${fallos} chequeo(s) fallaron`);
  if (fallos > 0) process.exitCode = 1;
}

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
