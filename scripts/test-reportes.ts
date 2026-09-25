/**
 * Verificación del Prompt 6 a nivel servicios + DB (sobre una base con el
 * seed demo: `scripts/db-descartable.sh gestion_demo --demo`).
 *  2) ResumenDiario cuadra con Venta/PagoVenta/Gasto (5 fechas) y después de rebuild.
 *  3) KPIs "este mes" vs "mes anterior" (cálculo de un delta a mano).
 *  5) Caja: abrir 20.000, 3 ventas efectivo, 1 gasto efectivo, 1 retiro, cerrar con faltante.
 *  6) Efectivo sin caja abierta: fuera de caja; con exigirCajaAbierta → rechazo.
 *  7) Rotación SIN_MOVIMIENTO y sugerencia de reposición (2/día × 15 − 10 = 20).
 * Uso: DATABASE_URL=…/gestion_demo pnpm test:reportes
 */
import { MedioPago, Prisma, RolUsuario, TipoMovimiento } from "@prisma/client";

import { prisma, withTransaction } from "../src/lib/db";
import { ahora, fijarReloj } from "../src/lib/reloj";
import { borradorVentaSchema } from "../src/lib/validations/venta";
import {
  diaEn,
  inicioDia,
  limitesRango,
  rangoComparable,
  rangoDePeriodo,
  sumarDias,
} from "../src/lib/zona-horaria";
import { DomainError } from "../src/server/errors";
import {
  abrirCaja,
  cerrarCaja,
  obtenerCaja,
  obtenerCajaAbierta,
  registrarRetiro,
} from "../src/server/services/caja.service";
import {
  invalidarCacheConfigFinanzas,
  obtenerZonaHoraria,
} from "../src/server/services/configuracion.service";
import { crearGasto } from "../src/server/services/gasto.service";
import { generarSku } from "../src/server/services/producto.service";
import {
  alertasStock,
  efectivoFueraDeCaja,
  kpis,
  rotacionInventario,
} from "../src/server/services/reporte.service";
import { reconstruirResumenDiario } from "../src/server/services/resumen-diario.service";
import { registrarMovimiento } from "../src/server/services/stock.service";
import { vender } from "../src/server/services/venta.service";

let fallos = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) fallos++;
  console.log(`  ${cond ? "✔" : "✘"} ${msg}`);
};
const $ = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v).toFixed(2);

async function main() {
  const tz = await obtenerZonaHoraria();
  const hoy = diaEn(new Date(), tz);
  const owner = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.OWNER, email: "dueno1@negocio.com" },
  });
  const actor = { id: owner.id, meta: { ip: "127.0.0.1", userAgent: "test-reportes" } };
  const [g1, g2] = await prisma.deposito.findMany({
    orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }],
  });
  if (!g1 || !g2) throw new Error("Faltan depósitos");

  // ---------------------------------------------------------------------------
  console.log("\n2) ResumenDiario vs. suma manual desde Venta / PagoVenta / Gasto / Devolucion");
  const dias = await prisma.$queryRaw<{ fecha: Date }[]>`
    SELECT "fecha" FROM "ResumenDiario" WHERE "depositoId" IS NULL AND "cantidadVentas" > 0 ORDER BY md5("fecha"::text) LIMIT 5`;
  async function manual(dia: string, depositoId: string | null) {
    const { inicio, fin } = limitesRango(dia, dia, tz);
    const r = (a: Date) => Prisma.sql`(${a}::timestamptz AT TIME ZONE 'UTC')`;
    const dep = (col: string) =>
      depositoId ? Prisma.sql`AND ${Prisma.raw(col)} = ${depositoId}` : Prisma.empty;
    const [v] = await prisma.$queryRaw<
      { n: bigint; total: Prisma.Decimal | null; costo: Prisma.Decimal | null }[]
    >`
      SELECT COUNT(*) n, SUM("total") total, SUM("costoTotal") costo FROM "Venta"
      WHERE "estado" = 'CONFIRMADA' AND "fecha" >= ${r(inicio)} AND "fecha" < ${r(fin)} ${dep('"depositoId"')}`;
    const [u] = await prisma.$queryRaw<{ u: bigint | null }[]>`
      SELECT SUM(vi."cantidad") u FROM "VentaItem" vi JOIN "Venta" v ON v."id" = vi."ventaId"
      WHERE v."estado" = 'CONFIRMADA' AND v."fecha" >= ${r(inicio)} AND v."fecha" < ${r(fin)} ${dep('v."depositoId"')}`;
    const [g] = await prisma.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT SUM("monto") total FROM "Gasto" WHERE "deletedAt" IS NULL AND "fecha" >= ${r(inicio)} AND "fecha" < ${r(fin)} ${dep('"depositoId"')}`;
    const pagos = await prisma.$queryRaw<{ medio: string; total: Prisma.Decimal }[]>`
      SELECT p."medioPago"::text medio, SUM(p."monto") total FROM "PagoVenta" p JOIN "Venta" v ON v."id" = p."ventaId"
      WHERE NOT p."anulado" AND p."fecha" >= ${r(inicio)} AND p."fecha" < ${r(fin)} ${dep('v."depositoId"')} GROUP BY 1`;
    const [d] = await prisma.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT SUM("total") total FROM "Devolucion" WHERE "fecha" >= ${r(inicio)} AND "fecha" < ${r(fin)} ${dep('"depositoId"')}`;
    return {
      cantidad: Number(v!.n),
      unidades: Number(u!.u ?? 0),
      total: $(v!.total ?? 0),
      costo: $(v!.costo ?? 0),
      gastos: $(g!.total ?? 0),
      devoluciones: $(d!.total ?? 0),
      medios: Object.fromEntries(pagos.map((p) => [p.medio, $(p.total)]).sort()),
    };
  }
  async function precalculado(dia: string, depositoId: string | null) {
    const f = await prisma.resumenDiario.findFirst({
      where: { fecha: new Date(`${dia}T00:00:00Z`), depositoId },
    });
    // Sin fila = ese depósito no tuvo actividad ese día (el incremental solo escribe lo que toca).
    if (!f)
      return {
        cantidad: 0,
        unidades: 0,
        total: "0.00",
        costo: "0.00",
        gastos: "0.00",
        devoluciones: "0.00",
        medios: {},
      };
    return {
      cantidad: f.cantidadVentas,
      unidades: f.unidadesVendidas,
      total: $(f.totalVentas),
      costo: $(f.costoVentas),
      gastos: $(f.totalGastos),
      devoluciones: $(f.devoluciones),
      medios: Object.fromEntries(
        Object.entries(f.totalPorMedioPago as Record<string, string>)
          .map(([k, v]) => [k, $(v)])
          .sort(),
      ),
    };
  }
  async function compararTodo(etiqueta: string) {
    for (const { fecha } of dias) {
      const dia = fecha.toISOString().slice(0, 10);
      for (const dep of [null, g1!.id, g2!.id]) {
        const [m, p] = await Promise.all([manual(dia, dep), precalculado(dia, dep)]);
        const igual = JSON.stringify(m) === JSON.stringify(p);
        check(
          igual,
          `${etiqueta} ${dia} ${dep === null ? "consolidado" : dep === g1!.id ? "Galpón 1" : "Galpón 2"}: ${m.cantidad} ventas · ${m.unidades} u. · $${m.total} · costo $${m.costo} · gastos $${m.gastos} · devol. $${m.devoluciones} · ${JSON.stringify(m.medios)}${igual ? "" : `  ≠  ${JSON.stringify(p)}`}`,
        );
      }
    }
  }
  await compararTodo("incremental");
  const antes = await prisma.$queryRaw<{ h: string }[]>`
    SELECT md5(string_agg(concat_ws('|', "fecha", "depositoId", "cantidadVentas", "unidadesVendidas", "totalVentas", "costoVentas", "gananciaBruta", "totalGastos", "gananciaNeta", "totalPorMedioPago"::text, "devoluciones", "costoDevoluciones"), ';' ORDER BY "fecha", "depositoId")) h
    FROM "ResumenDiario" WHERE "cantidadVentas" > 0 OR "totalGastos" > 0 OR "totalPorMedioPago" <> '{}' OR "devoluciones" > 0`;
  const t0 = performance.now();
  const rb = await reconstruirResumenDiario();
  console.log(
    `   pnpm reportes:rebuild → ${rb.filas} filas (${rb.desde} → ${rb.hasta}) en ${Math.round(performance.now() - t0)} ms`,
  );
  await compararTodo("rebuild");
  const despues = await prisma.$queryRaw<{ h: string }[]>`
    SELECT md5(string_agg(concat_ws('|', "fecha", "depositoId", "cantidadVentas", "unidadesVendidas", "totalVentas", "costoVentas", "gananciaBruta", "totalGastos", "gananciaNeta", "totalPorMedioPago"::text, "devoluciones", "costoDevoluciones"), ';' ORDER BY "fecha", "depositoId")) h
    FROM "ResumenDiario" WHERE "cantidadVentas" > 0 OR "totalGastos" > 0 OR "totalPorMedioPago" <> '{}' OR "devoluciones" > 0`;
  check(
    antes[0]!.h === despues[0]!.h,
    `toda la tabla (días con actividad) idéntica antes y después del rebuild: ${antes[0]!.h.slice(0, 12)}… = ${despues[0]!.h.slice(0, 12)}…`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n3) KPIs «Este mes» vs. «Mes anterior»");
  const esteMes = rangoDePeriodo("mes", hoy);
  const kMes = await kpis(esteMes);
  const comp = rangoComparable(esteMes);
  const suma = async (r: { desde: string; hasta: string }) => {
    const { inicio, fin } = limitesRango(r.desde, r.hasta, tz);
    const [x] = await prisma.$queryRaw<{ t: Prisma.Decimal | null }[]>`
      SELECT SUM("total") t FROM "Venta" WHERE "estado" = 'CONFIRMADA'
        AND "fecha" >= (${inicio}::timestamptz AT TIME ZONE 'UTC') AND "fecha" < (${fin}::timestamptz AT TIME ZONE 'UTC')`;
    return new Prisma.Decimal(x!.t ?? 0);
  };
  const [a, b] = [await suma(esteMes), await suma(comp)];
  const deltaManual = a.minus(b).div(b).mul(100).toDecimalPlaces(1).toNumber();
  console.log(
    `   Ventas ${esteMes.desde}→${esteMes.hasta}: $${a.toFixed(2)} (desde Venta)  ·  ${comp.desde}→${comp.hasta}: $${b.toFixed(2)}`,
  );
  console.log(
    `   delta = (${a.toFixed(2)} − ${b.toFixed(2)}) / ${b.toFixed(2)} × 100 = ${deltaManual} %`,
  );
  check(
    kMes.ventas.actual === a.toFixed(2) &&
      kMes.ventas.anterior === b.toFixed(2) &&
      kMes.ventas.delta === deltaManual,
    `kpis().ventas = ${JSON.stringify(kMes.ventas)}`,
  );
  const mesAnt = rangoDePeriodo("mes-anterior", hoy);
  const kAnt = await kpis(mesAnt);
  check(
    kAnt.periodoAnterior.desde.endsWith("-01"),
    `«Mes anterior» (${mesAnt.desde}→${mesAnt.hasta}) se compara con ${kAnt.periodoAnterior.desde}→${kAnt.periodoAnterior.hasta}`,
  );
  for (const [k, v] of Object.entries(kMes).filter(([k]) => !k.startsWith("periodo"))) {
    console.log(`   ${k.padEnd(15)} ${JSON.stringify(v)}`);
  }

  // ---------------------------------------------------------------------------
  console.log(
    "\n5) Caja en Galpón 2: abrir $20.000, 3 ventas en efectivo, 1 gasto en efectivo, 1 retiro",
  );
  const variante = await prisma.variante.findFirstOrThrow({ where: { nombre: "Blue Razz Ice" } });
  const abierta = await obtenerCajaAbierta(g2.id);
  if (abierta)
    await cerrarCaja(abierta.id, { montoContado: Number(abierta.totales.esperado) }, actor);
  const { id: cajaId } = await abrirCaja({ depositoId: g2.id, montoInicial: 20000 }, actor);
  const segunda = await abrirCaja({ depositoId: g2.id, montoInicial: 1 }, actor).catch(
    (e: unknown) => e,
  );
  check(
    segunda instanceof DomainError,
    `abrir otra caja en Galpón 2 → «${(segunda as Error).message}»`,
  );
  let efectivo = new Prisma.Decimal(0);
  for (let i = 0; i < 3; i++) {
    const v = await vender(
      {
        venta: borradorVentaSchema.parse({
          depositoId: g2.id,
          items: [{ varianteId: variante.id, cantidad: 1 }],
        }),
        pagos: [{ medioPago: MedioPago.EFECTIVO, monto: variante.precioVenta.toNumber() }],
        redondearA: 0,
      },
      actor,
      { puedeEditar: true },
    );
    efectivo = efectivo.plus(v.total);
  }
  await crearGasto(
    {
      fecha: hoy,
      categoriaGastoId: "cgasto_insumos",
      descripcion: "Bolsas (test)",
      monto: 3500,
      medioPago: "EFECTIVO",
      depositoId: g2.id,
      recurrente: false,
    },
    null,
    actor,
  );
  await registrarRetiro({ cajaId, monto: 30000, descripcion: "Al banco (test)" }, actor);
  const c = await obtenerCaja(cajaId);
  const esperado = new Prisma.Decimal(20000).plus(efectivo).minus(3500).minus(30000);
  console.log(
    `   20.000 + ventas ${efectivo.toFixed(2)} − gasto 3.500 − retiro 30.000 = ${esperado.toFixed(2)}`,
  );
  check(
    c.totales.esperado === esperado.toFixed(2),
    `esperado en vivo = ${c.totales.esperado} (${JSON.stringify(c.totales)})`,
  );
  const cierre = await cerrarCaja(cajaId, { montoContado: esperado.minus(500).toNumber() }, actor);
  check(
    cierre.diferencia === "-500.00" && !cierre.requiereRevision,
    `cierre con $500 de menos → diferencia ${cierre.diferencia}, requiereRevision=${cierre.requiereRevision} (tolerancia $500: la regla es |dif| > tolerancia)`,
  );
  const { id: caja2 } = await abrirCaja({ depositoId: g2.id, montoInicial: 20000 }, actor);
  const sinObs = await cerrarCaja(caja2, { montoContado: 19400 }, actor).catch((e: unknown) => e);
  check(
    sinObs instanceof Error && /tolerancia/.test((sinObs as Error).message),
    `con $600 de menos y sin observaciones → «${(sinObs as Error).message}»`,
  );
  const c2 = await cerrarCaja(
    caja2,
    { montoContado: 19400, observaciones: "Faltan $600 (test)" },
    actor,
  );
  check(
    c2.diferencia === "-600.00" && c2.requiereRevision,
    `con observaciones → diferencia ${c2.diferencia}, requiereRevision=${c2.requiereRevision}`,
  );
  const tocar =
    await prisma.$executeRaw`UPDATE "Caja" SET "observaciones" = 'x' WHERE "id" = ${cajaId}`.catch(
      (e: unknown) => e,
    );
  check(
    tocar instanceof Error && /cerrada/.test((tocar as Error).message),
    "una caja cerrada no se modifica (trigger)",
  );
  const movCaja =
    await prisma.$executeRaw`DELETE FROM "MovimientoCaja" WHERE "cajaId" = ${cajaId}`.catch(
      (e: unknown) => e,
    );
  check(
    movCaja instanceof Error && /inmutable/.test((movCaja as Error).message),
    "MovimientoCaja es inmutable (trigger)",
  );
  console.log(`   PDF del cierre: GET /api/caja/${cajaId}/pdf`);

  // ---------------------------------------------------------------------------
  console.log("\n6) Efectivo sin caja abierta");
  const antesFuera = await efectivoFueraDeCaja({ desde: hoy, hasta: hoy, depositoId: g2.id });
  const v6 = await vender(
    {
      venta: borradorVentaSchema.parse({
        depositoId: g2.id,
        items: [{ varianteId: variante.id, cantidad: 1 }],
      }),
      pagos: [{ medioPago: MedioPago.EFECTIVO, monto: variante.precioVenta.toNumber() }],
      redondearA: 0,
    },
    actor,
    { puedeEditar: true },
  );
  const pago = await prisma.pagoVenta.findFirstOrThrow({ where: { ventaId: v6.id } });
  const despuesFuera = await efectivoFueraDeCaja({ desde: hoy, hasta: hoy, depositoId: g2.id });
  check(
    pago.cajaId === null,
    `venta #${v6.numero} en efectivo sin caja: se permite, PagoVenta.cajaId = null`,
  );
  check(
    new Prisma.Decimal(despuesFuera.total).minus(antesFuera.total).equals(variante.precioVenta),
    `«efectivo fuera de caja» del día: ${antesFuera.total} → ${despuesFuera.total}`,
  );
  await prisma.configuracion.upsert({
    where: { clave: "exigirCajaAbierta" },
    create: { clave: "exigirCajaAbierta", valor: true },
    update: { valor: true },
  });
  invalidarCacheConfigFinanzas();
  const rechazo = await vender(
    {
      venta: borradorVentaSchema.parse({
        depositoId: g2.id,
        items: [{ varianteId: variante.id, cantidad: 1 }],
      }),
      pagos: [{ medioPago: MedioPago.EFECTIVO, monto: variante.precioVenta.toNumber() }],
      redondearA: 0,
    },
    actor,
    { puedeEditar: true },
  ).catch((e: unknown) => e);
  check(
    rechazo instanceof DomainError && rechazo.code === "CAJA_CERRADA",
    `con exigirCajaAbierta = true → «${(rechazo as Error).message}»`,
  );
  const conTransfer = await vender(
    {
      venta: borradorVentaSchema.parse({
        depositoId: g2.id,
        items: [{ varianteId: variante.id, cantidad: 1 }],
      }),
      pagos: [{ medioPago: MedioPago.TRANSFERENCIA, monto: variante.precioVenta.toNumber() }],
      redondearA: 0,
    },
    actor,
    { puedeEditar: true },
  ).catch((e: unknown) => e);
  check(!(conTransfer instanceof Error), "…pero por transferencia se puede cobrar igual");
  await prisma.configuracion.update({
    where: { clave: "exigirCajaAbierta" },
    data: { valor: false },
  });
  invalidarCacheConfigFinanzas();

  // ---------------------------------------------------------------------------
  console.log("\n7) Rotación y sugerencia de reposición");
  const u30 = { desde: sumarDias(hoy, -29), hasta: hoy };
  const rot = await rotacionInventario(u30);
  const cafe = rot.filas.find((f) => f.sabor === "Café Tabaco");
  check(
    cafe?.clase === "SIN_MOVIMIENTO" && cafe.stock > 0,
    `Lost Mary — Café Tabaco: stock ${cafe?.stock}, vendidas ${cafe?.vendidas} en 30 días → ${cafe?.clase}`,
  );
  // Un sabor nuevo que vende exactamente 2 por día durante los últimos 30 días y queda con 10.
  const categoria = await prisma.categoria.findFirstOrThrow({ where: { nombre: "Vapes" } });
  const nombre = `Test Reposición ${Date.now()}`;
  const nueva = await withTransaction(async (tx) => {
    const p = await tx.producto.create({
      data: { nombre, categoriaId: categoria.id, tieneVariantes: true },
    });
    return tx.variante.create({
      data: {
        productoId: p.id,
        nombre: "Menta",
        sku: await generarSku(tx),
        precioCosto: 5000,
        precioVenta: 9000,
        stockMinimo: 5,
      },
    });
  });
  fijarReloj(() => new Date(inicioDia(sumarDias(hoy, -30), tz).getTime() + 10 * 3600_000));
  await withTransaction((tx) =>
    registrarMovimiento(tx, {
      tipo: TipoMovimiento.INGRESO_MANUAL,
      varianteId: nueva.id,
      depositoId: g1.id,
      cantidad: 70,
      costoUnitario: 5000,
      motivo: "Stock (test)",
      usuarioId: owner.id,
    }),
  );
  for (let i = 29; i >= 0; i--) {
    const dia = sumarDias(hoy, -i);
    fijarReloj(() =>
      i === 0
        ? new Date(Date.now() - 60_000)
        : new Date(inicioDia(dia, tz).getTime() + 15 * 3600_000),
    );
    await vender(
      {
        venta: borradorVentaSchema.parse({
          depositoId: g1.id,
          items: [{ varianteId: nueva.id, cantidad: 2 }],
        }),
        pagos: [{ medioPago: MedioPago.TRANSFERENCIA, monto: 18000 }],
        redondearA: 0,
      },
      actor,
      { puedeEditar: true },
    );
  }
  fijarReloj(null);
  const stockNueva = (
    await prisma.stock.findFirstOrThrow({ where: { varianteId: nueva.id, depositoId: g1.id } })
  ).cantidad;
  const al = await alertasStock();
  const a7 = al.alertas.find((x) => x.varianteId === nueva.id);
  console.log(
    `   vendió 60 en 30 días (2/día), stock ${stockNueva}, cobertura ${al.diasCobertura} días → 2 × ${al.diasCobertura} − ${stockNueva} = ${2 * al.diasCobertura - stockNueva}`,
  );
  check(
    a7?.promedioDiario === 2 && a7.stockTotal === 10 && a7.sugerencia === 20,
    `alertasStock(): promedio ${a7?.promedioDiario}/día, stock ${a7?.stockTotal}, sugerencia ${a7?.sugerencia} (por depósito: ${JSON.stringify(a7?.porDeposito.map((d) => ({ [d.deposito]: d.sugerencia })))})`,
  );
  const rot2 = await rotacionInventario(u30);
  const f7 = rot2.filas.find((f) => f.varianteId === nueva.id);
  check(
    f7?.clase === "RAPIDA",
    `rotación del sabor nuevo: ${f7?.diasDeStock} días de stock → ${f7?.clase}`,
  );

  console.log(`\n   (hora de negocio restaurada: ${ahora().toISOString()})`);
  console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTODO OK");
  process.exitCode = fallos ? 1 : 0;
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    fijarReloj(null);
    return prisma.$disconnect();
  });
