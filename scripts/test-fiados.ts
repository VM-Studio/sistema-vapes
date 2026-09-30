/**
 * Pagos mixtos y fiados (A1) a nivel servicios + DB, panel Vapes. Verifica los
 * puntos 1, 2, 3, 4, 7 y 8 de la sección VERIFICACIÓN de
 * docs/specs/A1-pagos-fiados-transferencias.md:
 *  1. Pago dividido (efectivo + transferencia): 2 PagoVenta, PAGADA, medio
 *     principal, donut por medio; pagos de más → DomainError.
 *  2. Venta fiada: PARCIAL, saldo del cliente, /fiados con antigüedad, cobro
 *     posterior, cobro de más → error, anular la venta fiada revierte todo.
 *  3. Un cobro imputado a dos ventas (de la más vieja a la más nueva).
 *  4. Trinidad: divide pagos, pero no fía, no cobra y no ve Fiados.
 *  7. Migración de datos: ventas viejas → PagoVenta + PAGADA (en una base
 *     auxiliar `<base>_mig`) e invariantes de montos en la base del test.
 *  8. 10 cobros simultáneos de $1.000 sobre una deuda de $5.000 → pasan 5.
 * Uso: DATABASE_URL=… pnpm test:fiados — SOLO contra una base descartable
 * recién sembrada (crea datos y recrea la base auxiliar `<base>_mig`).
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  EstadoPago,
  EstadoVenta,
  MedioPago,
  Prisma,
  PrismaClient,
  RolUsuario,
} from "@prisma/client";

import { prisma } from "../src/lib/db";
import { puede } from "../src/lib/permisos";
import { fijarReloj } from "../src/lib/reloj";
import { generarVentaSchema } from "../src/lib/validations/venta";
import { dbPara, transaccion, type Ctx } from "../src/server/db/panel-scoped";
import { DomainError, ForbiddenError } from "../src/server/errors";
import {
  kpis,
  periodoDesdeParams,
  ventasPorMedioPago,
} from "../src/server/services/analitica.service";
import { crearCliente } from "../src/server/services/cliente.service";
import {
  anularCobro,
  cuentaCorriente,
  deudores,
  puedeFiados,
  registrarCobro,
} from "../src/server/services/fiado.service";
import { registrarAjuste } from "../src/server/services/movimiento.service";
import { anularVenta, generarVenta } from "../src/server/services/venta.service";

const VAPES = "pnl_vapes";
const db = dbPara(VAPES);
const DIA = 24 * 3600 * 1000;
const MIGRACION_A1 = "20261004090000_pagos_fiados_transferencias";

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

/** Nombre de la base de DATABASE_URL: nunca la de desarrollo. */
function baseDelTest(): { url: string; base: string } {
  const url = process.env.DATABASE_URL ?? "";
  const base = new URL(url).pathname.replace(/^\//, "");
  if (!base || base === "gestion") {
    throw new Error(
      `test-fiados crea datos: corrélo contra una base descartable (DATABASE_URL = "${base}").`,
    );
  }
  return { url, base };
}

async function main() {
  const { url, base } = baseDelTest();
  console.log(`Base: ${base}`);
  const owner = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.OWNER, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  const trinidad = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.EMPLEADO, deletedAt: null, paneles: { some: { panelId: VAPES } } },
    include: { permisos: true, paneles: { select: { panelId: true } } },
    orderBy: { createdAt: "asc" },
  });
  const meta = { ip: "127.0.0.1", userAgent: "test-fiados" };
  const ctx: Ctx = { panelId: VAPES, usuarioId: owner.id, meta };
  const ctxTri: Ctx = { panelId: VAPES, usuarioId: trinidad.id, meta };
  const DUENO = { puedeEditar: true };

  // Catálogo propio: un pod de $10.000 y otro de $5.000, con stock en el galpón principal.
  const g1 = await db.deposito.findFirstOrThrow({ where: { esPrincipal: true } });
  const suf = String(Date.now()).slice(-7);
  const catalogo = await transaccion(ctx, async (tx) => {
    const marca = await tx.marca.upsert({
      where: { panelId_nombre: { panelId: VAPES, nombre: "Test Fiados" } },
      update: {},
      create: { nombre: "Test Fiados" },
    });
    const crear = (nombre: string, precio: string, sku: string) =>
      tx.producto.create({
        data: {
          marcaId: marca.id,
          nombre: `${nombre} ${suf}`,
          especificacion: "6000",
          precioVenta: precio,
          variantes: {
            create: [{ nombre: "Menta", sku: `${sku}-${suf}`, ultimoCosto: "4000.00" }],
          },
        },
        include: { variantes: true },
      });
    return {
      diez: await crear("Pod Diez", "10000.00", "TF-10"),
      cinco: await crear("Pod Cinco", "5000.00", "TF-5"),
    };
  });
  const diez = catalogo.diez.variantes[0]!;
  const cinco = catalogo.cinco.variantes[0]!;
  for (const v of [diez, cinco]) {
    await registrarAjuste(ctx, {
      depositoId: g1.id,
      varianteId: v.id,
      cantidadReal: 100,
      motivo: "Preparación test-fiados",
    });
  }
  let tel = 0;
  const cliente = (nombre: string) =>
    crearCliente(ctx, { nombre, telefono: `11${suf.slice(-4)}${String(1000 + tel++)}` });
  const venta = (
    c: Ctx,
    clienteId: string,
    varianteId: string,
    cantidad: number,
    pagos: { medioPago: MedioPago; monto: number; referencia?: string }[],
    fiar = false,
  ) =>
    generarVenta(
      c,
      generarVentaSchema.parse({
        depositoId: g1.id,
        cliente: { id: clienteId },
        items: [{ varianteId, cantidad }],
        pagos,
        fiar,
      }),
      DUENO,
    );
  const saldoDe = async (clienteId: string) =>
    $((await db.cliente.findUniqueOrThrow({ where: { id: clienteId } })).saldoDeudor);
  const hoy = periodoDesdeParams({});
  const porMedio = async () =>
    Object.fromEntries((await ventasPorMedioPago(ctx, hoy)).map((m) => [m.medio, Number(m.total)]));

  // ---------------------------------------------------------------------------
  console.log("\n1) Venta de $30.000: Efectivo $20.000 + Transferencia $10.000");
  const c1 = await cliente("Cliente pago mixto");
  const medioAntes = await porMedio();
  const v1 = await venta(ctx, c1.id, diez.id, 3, [
    { medioPago: "EFECTIVO", monto: 20000 },
    { medioPago: "TRANSFERENCIA", monto: 10000, referencia: "OP-123" },
  ]);
  const pagos1 = await db.pagoVenta.findMany({
    where: { ventaId: v1.id },
    orderBy: { monto: "desc" },
  });
  const fila1 = await db.venta.findUniqueOrThrow({ where: { id: v1.id } });
  check(
    pagos1.length === 2 &&
      $(pagos1[0]!.monto) === "20000.00" &&
      pagos1[0]!.medioPago === MedioPago.EFECTIVO &&
      $(pagos1[1]!.monto) === "10000.00" &&
      pagos1[1]!.referencia === "OP-123",
    "2 PagoVenta: EFECTIVO $20.000 y TRANSFERENCIA $10.000 (con referencia)",
  );
  check(
    fila1.estadoPago === EstadoPago.PAGADA &&
      $(fila1.montoPagado) === "30000.00" &&
      $(fila1.saldoPendiente) === "0.00",
    `PAGADA, pagado ${$(fila1.montoPagado)}, pendiente ${$(fila1.saldoPendiente)}`,
  );
  check(fila1.medioPago === MedioPago.EFECTIVO, "medio principal EFECTIVO (el de mayor monto)");
  const medioDespues = await porMedio();
  check(
    medioDespues.EFECTIVO! - medioAntes.EFECTIVO! === 20000 &&
      medioDespues.TRANSFERENCIA! - medioAntes.TRANSFERENCIA! === 10000,
    "el donut de medios de pago suma $20.000 y $10.000 por separado",
  );
  const ventasAntes = await db.venta.count();
  const demas = await error(() =>
    venta(ctx, c1.id, diez.id, 3, [
      { medioPago: "EFECTIVO", monto: 20000 },
      { medioPago: "BINANCE", monto: 15000 },
    ]),
  );
  check(
    demas instanceof DomainError && (await db.venta.count()) === ventasAntes,
    `pagos por $35.000 → DomainError y no se registra nada («${msg(demas)}»)`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n2) Venta de $30.000 fiada con $10.000 en efectivo (vende Juan Cruz)");
  const c2 = await cliente("Cliente fiado");
  const sinFiar = await error(() =>
    venta(ctx, c2.id, diez.id, 3, [{ medioPago: "EFECTIVO", monto: 10000 }]),
  );
  check(
    sinFiar instanceof DomainError && /no cubre/.test(msg(sinFiar)),
    `pago incompleto sin «Fiar el resto» → DomainError («${msg(sinFiar).slice(0, 50)}…»)`,
  );
  // La venta se hace "hace 40 días" para ver la antigüedad en /fiados.
  fijarReloj(() => new Date(Date.now() - 40 * DIA));
  const v2 = await venta(ctx, c2.id, diez.id, 3, [{ medioPago: "EFECTIVO", monto: 10000 }], true);
  fijarReloj(null);
  const fila2 = await db.venta.findUniqueOrThrow({ where: { id: v2.id } });
  check(
    fila2.estadoPago === EstadoPago.PARCIAL &&
      $(fila2.saldoPendiente) === "20000.00" &&
      $(fila2.montoPagado) === "10000.00" &&
      fila2.vendedorId === owner.id,
    `PARCIAL, pagado ${$(fila2.montoPagado)}, saldoPendiente ${$(fila2.saldoPendiente)}`,
  );
  check((await saldoDe(c2.id)) === "20000.00", `cliente.saldoDeudor ${await saldoDe(c2.id)}`);
  const lista = await deudores(ctx, { page: 1, q: "Cliente fiado" });
  const d2 = lista.deudores.find((d) => d.id === c2.id);
  check(
    !!d2 && d2.saldo === "20000.00" && d2.ventasPendientes === 1 && d2.diasAntiguedad === 40,
    `/fiados lo lista: debe ${d2?.saldo}, ${d2?.ventasPendientes} venta pendiente, ${d2?.diasAntiguedad} días`,
  );
  const demasCobro = await error(() =>
    registrarCobro(ctx, { clienteId: c2.id, monto: 25000, medioPago: "BINANCE" }),
  );
  check(
    demasCobro instanceof DomainError && (await saldoDe(c2.id)) === "20000.00",
    `cobro de $25.000 (> saldo) → error, saldo intacto («${msg(demasCobro).slice(0, 60)}»)`,
  );
  const cobro2 = await registrarCobro(ctx, {
    clienteId: c2.id,
    monto: 20000,
    medioPago: "BINANCE",
    referencia: "BNB-1",
  });
  const fila2b = await db.venta.findUniqueOrThrow({ where: { id: v2.id } });
  const posterior = await db.pagoVenta.findFirst({
    where: { ventaId: v2.id, esCobroPosterior: true },
  });
  check(
    fila2b.estadoPago === EstadoPago.PAGADA && $(fila2b.saldoPendiente) === "0.00",
    "cobro de $20.000 por Binance → la venta queda PAGADA",
  );
  check(
    (await saldoDe(c2.id)) === "0.00" && cobro2.saldoRestante === "0.00",
    "saldo del cliente en 0",
  );
  check(
    !!posterior &&
      posterior.medioPago === MedioPago.BINANCE &&
      $(posterior.monto) === "20000.00" &&
      posterior.cobroId === cobro2.cobroId,
    "PagoVenta con esCobroPosterior (BINANCE $20.000, mismo cobroId)",
  );
  check(
    (await error(() =>
      registrarCobro(ctx, { clienteId: c2.id, monto: 1, medioPago: "EFECTIVO" }),
    )) instanceof DomainError,
    "sin deuda, cualquier cobro → DomainError",
  );
  const cc2 = await cuentaCorriente(ctx, c2.id);
  check(
    cc2.movimientos.length === 2 &&
      cc2.movimientos.at(-1)?.saldoAcumulado === "0.00" &&
      cc2.pendientes.length === 0,
    "cuenta corriente: venta +$20.000, cobro −$20.000, saldo acumulado 0",
  );

  // Anulación de un cobro (dueño) y de la venta fiada.
  const c2b = await cliente("Cliente fiado anulado");
  const v2b = await venta(ctx, c2b.id, diez.id, 3, [{ medioPago: "EFECTIVO", monto: 10000 }], true);
  const cobro2b = await registrarCobro(ctx, {
    clienteId: c2b.id,
    monto: 5000,
    medioPago: "TRANSFERENCIA",
  });
  const pagoCobro = await db.pagoVenta.findFirstOrThrow({ where: { cobroId: cobro2b.cobroId } });
  check(
    (await error(() => anularCobro(ctxTri, pagoCobro.id, "prueba"))) instanceof ForbiddenError,
    "anular un cobro siendo empleado → ForbiddenError",
  );
  await anularCobro(ctx, pagoCobro.id, "Se cargó dos veces");
  check(
    (await saldoDe(c2b.id)) === "20000.00" &&
      (await db.pagoVenta.findUniqueOrThrow({ where: { id: pagoCobro.id } })).anulado,
    "anular el cobro (dueño): el pago queda anulado y la deuda vuelve a $20.000",
  );
  await registrarCobro(ctx, { clienteId: c2b.id, monto: 5000, medioPago: "EFECTIVO" });
  const stockAntes = (
    await db.stock.findFirstOrThrow({ where: { varianteId: diez.id, depositoId: g1.id } })
  ).cantidad;
  await anularVenta(ctx, v2b.id, "Prueba de anulación de venta fiada");
  const anulada = await db.venta.findUniqueOrThrow({
    where: { id: v2b.id },
    include: { pagos: true },
  });
  check(
    anulada.estado === EstadoVenta.ANULADA &&
      anulada.pagos.length === 3 &&
      anulada.pagos.every((p) => p.anulado) &&
      $(anulada.montoPagado) === "0.00" &&
      $(anulada.saldoPendiente) === "0.00",
    `anular la venta fiada → sus ${anulada.pagos.length} pagos anulados, montos en 0`,
  );
  check((await saldoDe(c2b.id)) === "0.00", "saldoDeudor del cliente revertido a 0");
  check(
    (await db.stock.findFirstOrThrow({ where: { varianteId: diez.id, depositoId: g1.id } }))
      .cantidad ===
      stockAntes + 3,
    "el stock volvió al galpón",
  );

  // ---------------------------------------------------------------------------
  console.log("\n3) Cobro de $25.000 a un cliente con dos ventas pendientes ($15.000 y $20.000)");
  const c3 = await cliente("Cliente dos ventas");
  fijarReloj(() => new Date(Date.now() - 2 * DIA));
  const v3a = await venta(ctx, c3.id, cinco.id, 3, [], true);
  fijarReloj(null);
  const v3b = await venta(ctx, c3.id, cinco.id, 4, [], true);
  check(
    v3a.estadoPago === EstadoPago.PENDIENTE &&
      v3a.medioPago === null &&
      v3b.saldoPendiente === "20000.00",
    "fiado total: PENDIENTE, sin medio principal",
  );
  check((await saldoDe(c3.id)) === "35000.00", `saldo del cliente ${await saldoDe(c3.id)}`);
  const cobro3 = await registrarCobro(ctx, {
    clienteId: c3.id,
    monto: 25000,
    medioPago: "EFECTIVO",
  });
  const f3a = await db.venta.findUniqueOrThrow({ where: { id: v3a.id } });
  const f3b = await db.venta.findUniqueOrThrow({ where: { id: v3b.id } });
  check(
    f3a.estadoPago === EstadoPago.PAGADA && $(f3a.saldoPendiente) === "0.00",
    `la primera (${v3a.codigo}) queda PAGADA`,
  );
  check(
    f3b.estadoPago === EstadoPago.PARCIAL && $(f3b.saldoPendiente) === "10000.00",
    `la segunda (${v3b.codigo}) queda PARCIAL con saldo ${$(f3b.saldoPendiente)}`,
  );
  const pagos3 = await db.pagoVenta.findMany({ where: { cobroId: cobro3.cobroId } });
  check(
    pagos3.length === 2 &&
      pagos3.every((p) => p.esCobroPosterior) &&
      cobro3.imputaciones.map((i) => i.monto).join("+") === "15000.00+10000.00",
    "un PagoVenta por venta tocada con el mismo cobroId ($15.000 + $10.000)",
  );
  check((await saldoDe(c3.id)) === "10000.00", "saldo del cliente $10.000");

  // ---------------------------------------------------------------------------
  console.log("\n4) Trinidad (sin FIADOS)");
  const c4 = await cliente("Cliente de Trinidad");
  const v4 = await venta(ctxTri, c4.id, cinco.id, 2, [
    { medioPago: "EFECTIVO", monto: 6000 },
    { medioPago: "BINANCE", monto: 4000 },
  ]);
  check(v4.estadoPago === EstadoPago.PAGADA && v4.pagos.length === 2, "puede dividir pagos");
  const sujeto = {
    rol: trinidad.rol,
    permisos: trinidad.permisos,
    paneles: trinidad.paneles.map((p) => p.panelId),
  };
  check(
    !puede(sujeto, VAPES, "FIADOS", "crear") && !(await puedeFiados(ctxTri, "crear")),
    "no ve «Fiar el resto» (sin FIADOS crear)",
  );
  const ventasTri = await db.venta.count();
  const forzada = await error(() =>
    venta(ctxTri, c4.id, cinco.id, 2, [{ medioPago: "EFECTIVO", monto: 6000 }], true),
  );
  check(
    forzada instanceof ForbiddenError && (await db.venta.count()) === ventasTri,
    `forzar generarVenta con pagos < total → ForbiddenError («${msg(forzada)}»)`,
  );
  // La página, las acciones y la navegación usan esta misma regla (FIADOS "ver").
  check(
    !puede(sujeto, VAPES, "FIADOS", "ver") && !(await puedeFiados(ctxTri, "ver")),
    "no ve /fiados (sin FIADOS ver)",
  );
  check(
    (await error(() =>
      registrarCobro(ctxTri, { clienteId: c3.id, monto: 100, medioPago: "EFECTIVO" }),
    )) instanceof ForbiddenError,
    "no puede registrar cobros",
  );
  const kTri = await kpis(ctxTri, hoy);
  check(
    kTri.cobrado === null && kTri.porCobrar === null,
    "el dashboard no le muestra Cobrado ni Por cobrar",
  );
  const kOwner = await kpis(ctx, hoy);
  check(
    kOwner.porCobrar === $(await deudaTotal()) && kOwner.cobrado !== null,
    `al dueño sí: por cobrar ${kOwner.porCobrar}, cobrado hoy ${kOwner.cobrado?.actual}`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n7) Migración de datos e invariantes de montos");
  await verificarMigracion(url, base);
  const [inv] = await prisma.$queryRaw<
    {
      ventas: number;
      sin_pago: number;
      mal_pagado: number;
      total: string;
      pagado_mas_pendiente: string;
    }[]
  >`
    SELECT COUNT(*)::int AS ventas,
           COUNT(*) FILTER (WHERE v."estadoPago" = 'PAGADA' AND v."total" > 0
             AND NOT EXISTS (SELECT 1 FROM "PagoVenta" p WHERE p."ventaId" = v."id" AND NOT p."anulado"))::int AS sin_pago,
           COUNT(*) FILTER (WHERE v."montoPagado" <> COALESCE((SELECT SUM(p."monto") FROM "PagoVenta" p
             WHERE p."ventaId" = v."id" AND NOT p."anulado"), 0))::int AS mal_pagado,
           COALESCE(SUM(v."total"), 0)::text AS total,
           COALESCE(SUM(v."montoPagado" + v."saldoPendiente"), 0)::text AS pagado_mas_pendiente
    FROM "Venta" v WHERE v."estado" = 'CONFIRMADA'`;
  check(
    inv!.sin_pago === 0 && inv!.mal_pagado === 0,
    `base del test: ${inv!.ventas} ventas confirmadas, todas con montoPagado = Σ pagos vigentes`,
  );
  check(
    $(inv!.total) === $(inv!.pagado_mas_pendiente),
    `Σ montoPagado + saldoPendiente = Σ total (${$(inv!.total)})`,
  );
  const [clientes] = await prisma.$queryRaw<{ mal: number }[]>`
    SELECT COUNT(*)::int AS mal FROM "Cliente" c
    WHERE c."saldoDeudor" <> COALESCE((SELECT SUM(v."saldoPendiente") FROM "Venta" v
      WHERE v."clienteId" = c."id" AND v."estado" = 'CONFIRMADA'), 0)`;
  check(clientes!.mal === 0, "cada cliente: saldoDeudor = Σ saldoPendiente de sus ventas");

  // ---------------------------------------------------------------------------
  console.log("\n8) 10 cobros simultáneos de $1.000 a un cliente que debe $5.000");
  const c8 = await cliente("Cliente concurrencia");
  await venta(ctx, c8.id, cinco.id, 1, [], true);
  const resultados = await Promise.allSettled(
    Array.from({ length: 10 }, () =>
      registrarCobro(ctx, { clienteId: c8.id, monto: 1000, medioPago: "EFECTIVO" }),
    ),
  );
  const ok = resultados.filter((r) => r.status === "fulfilled").length;
  const rechazados = resultados.filter(
    (r) => r.status === "rejected" && r.reason instanceof DomainError,
  ).length;
  check(
    ok === 5 && rechazados === 5,
    `pasan exactamente 5 (${ok} ok, ${rechazados} rechazados por saldo)`,
  );
  const pagos8 = await db.pagoVenta.count({
    where: { venta: { clienteId: c8.id }, esCobroPosterior: true, anulado: false },
  });
  check(
    (await saldoDe(c8.id)) === "0.00" && pagos8 === 5,
    `saldo final ${await saldoDe(c8.id)} y ${pagos8} PagoVenta de cobro`,
  );

  console.log(fallos === 0 ? "\nTodo OK" : `\n${fallos} chequeo(s) fallaron`);
  if (fallos > 0) process.exitCode = 1;

  async function deudaTotal() {
    return (await db.cliente.aggregate({ _sum: { saldoDeudor: true } }))._sum.saldoDeudor ?? 0;
  }
}

/**
 * Migración de datos: en una base auxiliar se aplican las migraciones
 * ANTERIORES a la del A1, se cargan ventas "viejas" (dos confirmadas y una
 * anulada, con el esquema de entonces) y se aplica la del A1.
 */
async function verificarMigracion(url: string, base: string) {
  const baseMig = `${base}_mig`;
  const urlMig = new URL(url);
  urlMig.pathname = `/${baseMig}`;
  const urlPostgres = new URL(url);
  urlPostgres.pathname = "/postgres";
  const admin = new PrismaClient({ datasourceUrl: urlPostgres.toString(), log: [] });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${baseMig}" WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${baseMig}"`);
  await admin.$disconnect();

  const env = { ...process.env, DATABASE_URL: urlMig.toString(), DIRECT_URL: urlMig.toString() };
  const deploy = (schema: string) => {
    const r = spawnSync("npx", ["prisma", "migrate", "deploy", "--schema", schema], {
      env,
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(`prisma migrate deploy falló: ${r.stderr || r.stdout}`);
  };
  // Esquema con las migraciones hasta la anterior al A1.
  const dir = mkdtempSync(join(tmpdir(), "fiados-mig-"));
  mkdirSync(join(dir, "migrations"));
  cpSync("prisma/schema.prisma", join(dir, "schema.prisma"));
  cpSync("prisma/migrations/migration_lock.toml", join(dir, "migrations", "migration_lock.toml"));
  for (const m of readdirSync("prisma/migrations")) {
    if (/^\d/.test(m) && m < MIGRACION_A1)
      cpSync(join("prisma/migrations", m), join(dir, "migrations", m), { recursive: true });
  }
  deploy(join(dir, "schema.prisma"));

  const mig = new PrismaClient({ datasourceUrl: urlMig.toString(), log: [] });
  try {
    await mig.$transaction([
      mig.$executeRaw`SELECT set_config('app.panel_id', 'pnl_vapes', true)`,
      mig.$executeRaw`INSERT INTO "Usuario" ("id","nombre","email","passwordHash","rol","updatedAt")
        VALUES ('usr_mig','Mig','mig@test.local','x','OWNER',now())`,
      mig.$executeRaw`INSERT INTO "Deposito" ("id","nombre","updatedAt") VALUES ('dep_mig','Galpón Mig',now())`,
      mig.$executeRaw`INSERT INTO "Marca" ("id","nombre","updatedAt") VALUES ('mar_mig','Marca Mig',now())`,
      mig.$executeRaw`INSERT INTO "Producto" ("id","marcaId","nombre","precioVenta","updatedAt")
        VALUES ('pro_mig','mar_mig','Pod Mig',1000,now())`,
      mig.$executeRaw`INSERT INTO "Variante" ("id","productoId","nombre","sku","updatedAt")
        VALUES ('var_mig','pro_mig','Uva','MIG-1',now())`,
      mig.$executeRaw`INSERT INTO "Cliente" ("id","nombre","telefono","updatedAt")
        VALUES ('cli_mig','Cliente Mig','+541100000001',now())`,
      mig.$executeRaw`INSERT INTO "Venta" ("id","numero","codigo","clienteId","depositoId","vendedorId","medioPago",
          "subtotal","total","costoTotal","gananciaBruta","updatedAt") VALUES
        ('ven_mig1',1,'VAP-000001','cli_mig','dep_mig','usr_mig','EFECTIVO',3000,3000,0,3000,now()),
        ('ven_mig2',2,'VAP-000002','cli_mig','dep_mig','usr_mig','BINANCE',2000,2000,0,2000,now()),
        ('ven_mig3',3,'VAP-000003','cli_mig','dep_mig','usr_mig','TRANSFERENCIA',1000,1000,0,1000,now())`,
      mig.$executeRaw`INSERT INTO "VentaItem" ("id","ventaId","varianteId","productoId","cantidad","precioLista",
          "precioUnitario","costoUnitario","subtotal","updatedAt") VALUES
        ('vi_mig1','ven_mig1','var_mig','pro_mig',3,1000,1000,0,3000,now()),
        ('vi_mig2','ven_mig2','var_mig','pro_mig',2,1000,1000,0,2000,now()),
        ('vi_mig3','ven_mig3','var_mig','pro_mig',1,1000,1000,0,1000,now())`,
    ]);
    await mig.$executeRaw`UPDATE "Venta" SET "estado" = 'ANULADA', "anuladaPorId" = 'usr_mig',
      "anuladaAt" = now(), "motivoAnulacion" = 'vieja anulada' WHERE "id" = 'ven_mig3'`;
    deploy("prisma/schema.prisma");
    const ventas = await mig.$queryRaw<
      {
        codigo: string;
        estado: string;
        estadoPago: string;
        montoPagado: string;
        saldoPendiente: string;
        total: string;
        pagos: number;
        medio: string | null;
        monto: string | null;
      }[]
    >`SELECT v."codigo", v."estado"::text AS "estado", v."estadoPago"::text AS "estadoPago",
             v."montoPagado"::text AS "montoPagado", v."saldoPendiente"::text AS "saldoPendiente",
             v."total"::text AS "total",
             (SELECT COUNT(*)::int FROM "PagoVenta" p WHERE p."ventaId" = v."id") AS "pagos",
             (SELECT p."medioPago"::text FROM "PagoVenta" p WHERE p."ventaId" = v."id" LIMIT 1) AS "medio",
             (SELECT p."monto"::text FROM "PagoVenta" p WHERE p."ventaId" = v."id" LIMIT 1) AS "monto"
      FROM "Venta" v ORDER BY v."numero"`;
    const confirmadas = ventas.filter((v) => v.estado === "CONFIRMADA");
    check(
      confirmadas.length === 2 &&
        confirmadas.every(
          (v) =>
            v.pagos === 1 &&
            v.estadoPago === "PAGADA" &&
            $(v.monto!) === $(v.total) &&
            v.medio !== null,
        ) &&
        confirmadas[1]!.medio === "BINANCE",
      `base auxiliar ${baseMig}: las ventas viejas confirmadas tienen su PagoVenta por el total (mismo medio) y quedan PAGADA`,
    );
    check(
      ventas.find((v) => v.estado === "ANULADA")?.pagos === 0,
      "la venta vieja anulada no recibe pagos",
    );
    const total = confirmadas.reduce((a, v) => a.plus(v.total), new Prisma.Decimal(0));
    const cubierto = confirmadas.reduce(
      (a, v) => a.plus(v.montoPagado).plus(v.saldoPendiente),
      new Prisma.Decimal(0),
    );
    check(total.equals(cubierto), `Σ montoPagado + saldoPendiente = Σ total (${$(total)})`);
  } finally {
    await mig.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    fijarReloj(null);
    return prisma.$disconnect();
  });
