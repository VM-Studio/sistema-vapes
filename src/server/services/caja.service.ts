import { AccionAuditoria, EstadoCaja, MedioPago, Prisma, TipoMovimientoCaja } from "@prisma/client";

import { prisma, withTransaction, type Tx } from "@/lib/db";
import { formatearPesos } from "@/lib/format";
import { ahora } from "@/lib/reloj";
import type { FiltrosCajas } from "@/lib/validations/finanzas";
import { limitesRango } from "@/lib/zona-horaria";
import { DomainError, NotFoundError, ValidationError } from "@/server/errors";
import type { Actor } from "@/server/services/actor";
import { registrarAuditoria } from "@/server/services/audit.service";
import { obtenerConfigFinanzas } from "@/server/services/configuracion.service";

/**
 * CAJA — el efectivo físico de cada depósito.
 *
 * - Una sola caja ABIERTA por depósito (índice único parcial en la DB).
 * - Solo el EFECTIVO pasa por la caja: cada cobro, devolución o gasto en
 *   efectivo inserta su MovimientoCaja en la MISMA transacción que lo origina.
 *   Transferencias, débito, MercadoPago, etc. se reportan aparte.
 * - MovimientoCaja es inmutable (trigger). El "esperado" se calcula SIEMPRE
 *   sumando los movimientos (nunca desde un caché); al cerrar, la DB verifica
 *   que el esperado guardado sea esa suma y que el CIERRE retire lo contado.
 * - Sin caja abierta, una venta en efectivo igual se permite (queda como
 *   "efectivo fuera de caja", visible en reportes) salvo que
 *   Configuracion.exigirCajaAbierta sea true.
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const CERO = D(0);
const dec = (d: Prisma.Decimal) => d.toFixed(2);
const $ = (d: Prisma.Decimal) => formatearPesos(d.toFixed(2));
const utc = (d: Date) => Prisma.sql`(${d}::timestamptz AT TIME ZONE 'UTC')`;

export const ETIQUETA_MOVIMIENTO_CAJA: Record<TipoMovimientoCaja, string> = {
  APERTURA: "Apertura",
  VENTA: "Venta",
  PAGO_CLIENTE: "Cobro a cliente",
  DEVOLUCION: "Devolución",
  GASTO: "Gasto",
  RETIRO: "Retiro",
  INGRESO_EXTRA: "Ingreso extra",
  CIERRE: "Cierre",
};

// =============================================================================
// Uso desde otras transacciones (ventas, cobros, devoluciones, gastos)
// =============================================================================

/**
 * Caja ABIERTA del depósito, con FOR SHARE: varias ventas pueden cobrar a la
 * vez, pero un cierre (UPDATE) espera a que terminen y viceversa.
 */
export async function cajaAbiertaEnTx(tx: Tx, depositoId: string): Promise<{ id: string } | null> {
  const [caja] = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Caja" WHERE "depositoId" = ${depositoId} AND "estado" = 'ABIERTA' FOR SHARE
  `;
  return caja ?? null;
}

/**
 * Caja donde entra (o sale) efectivo en `depositoId`. null = no hay caja
 * abierta y está permitido operar "fuera de caja". Con exigirCajaAbierta, lanza.
 */
export async function cajaParaEfectivo(
  tx: Tx,
  depositoId: string,
  que = "cobrar en efectivo",
): Promise<{ id: string } | null> {
  const caja = await cajaAbiertaEnTx(tx, depositoId);
  if (caja) return caja;
  const config = await obtenerConfigFinanzas(tx);
  if (config.exigirCajaAbierta) {
    const dep = await tx.deposito.findUnique({
      where: { id: depositoId },
      select: { nombre: true },
    });
    throw new DomainError(
      `La caja de ${dep?.nombre ?? "este depósito"} está cerrada: abrila para ${que} (o usá otro medio de pago).`,
      "CAJA_CERRADA",
      409,
    );
  }
  return null;
}

/** Efectivo que debería haber ahora en la caja (Σ movimientos). */
export async function efectivoEnCaja(tx: Tx, cajaId: string): Promise<Prisma.Decimal> {
  const [r] = await tx.$queryRaw<{ total: Prisma.Decimal | null }[]>`
    SELECT SUM("monto") AS total FROM "MovimientoCaja" WHERE "cajaId" = ${cajaId}
  `;
  return D(r?.total ?? 0);
}

/**
 * No puede salir de la caja más efectivo del que debería haber: la caja
 * nunca queda en negativo (un gasto, devolución o retiro así sería un error
 * de carga o plata que puso alguien de su bolsillo → ingreso extra primero).
 */
export async function verificarEfectivoDisponible(
  tx: Tx,
  cajaId: string,
  monto: Prisma.Decimal,
  para: string,
): Promise<void> {
  const hay = await efectivoEnCaja(tx, cajaId);
  if (monto.greaterThan(hay)) {
    throw new DomainError(
      `En la caja debería haber ${$(hay)}: no alcanza para ${para} (${$(monto)}). Usá otro medio o registrá primero un ingreso extra.`,
      "EFECTIVO_INSUFICIENTE",
      409,
      { monto: [`En la caja hay ${$(hay)}`] },
    );
  }
}

export interface NuevoMovimientoCaja {
  cajaId: string;
  tipo: TipoMovimientoCaja;
  /** Con signo (la DB valida el signo según el tipo). */
  monto: Prisma.Decimal;
  referenciaTipo?: "VENTA" | "DEVOLUCION" | "GASTO" | "CLIENTE" | null;
  referenciaId?: string | null;
  descripcion?: string | null;
  usuarioId: string;
}

export async function registrarMovimientoCaja(tx: Tx, m: NuevoMovimientoCaja) {
  return tx.movimientoCaja.create({
    data: {
      cajaId: m.cajaId,
      tipo: m.tipo,
      monto: m.monto,
      referenciaTipo: m.referenciaTipo ?? null,
      referenciaId: m.referenciaId ?? null,
      descripcion: m.descripcion ?? null,
      usuarioId: m.usuarioId,
      createdAt: ahora(),
    },
  });
}

// =============================================================================
// Totales en vivo
// =============================================================================

export interface TotalesCaja {
  inicial: string;
  ventas: string;
  pagosClientes: string;
  devoluciones: string;
  gastos: string;
  retiros: string;
  ingresosExtra: string;
  /** inicial + ventas + pagos − devoluciones − gastos − retiros + ingresos. */
  esperado: string;
  movimientos: number;
}

/** Suma de los movimientos por tipo (siempre desde la tabla, sin caché). */
async function totalesDe(tx: Tx, cajaIds: string[]): Promise<Map<string, TotalesCaja>> {
  const res = new Map<string, TotalesCaja>();
  if (cajaIds.length === 0) return res;
  const filas = await tx.$queryRaw<
    { cajaId: string; tipo: TipoMovimientoCaja; total: Prisma.Decimal; n: bigint }[]
  >`
    SELECT "cajaId", "tipo", SUM("monto") AS total, COUNT(*) AS n
    FROM "MovimientoCaja" WHERE "cajaId" IN (${Prisma.join(cajaIds)})
    GROUP BY "cajaId", "tipo"
  `;
  for (const id of cajaIds) {
    const de = (t: TipoMovimientoCaja) =>
      D(filas.find((f) => f.cajaId === id && f.tipo === t)?.total ?? 0);
    const esperado = filas
      .filter((f) => f.cajaId === id && f.tipo !== TipoMovimientoCaja.CIERRE)
      .reduce((a, f) => a.plus(f.total), CERO);
    res.set(id, {
      inicial: dec(de("APERTURA")),
      ventas: dec(de("VENTA")),
      pagosClientes: dec(de("PAGO_CLIENTE")),
      devoluciones: dec(de("DEVOLUCION").neg()),
      gastos: dec(de("GASTO").neg()),
      retiros: dec(de("RETIRO").neg()),
      ingresosExtra: dec(de("INGRESO_EXTRA")),
      esperado: dec(esperado),
      movimientos: filas.filter((f) => f.cajaId === id).reduce((a, f) => a + Number(f.n), 0),
    });
  }
  return res;
}

export interface CajaAbierta {
  id: string;
  depositoId: string;
  deposito: string;
  abiertaAt: Date;
  abiertaPor: string;
  montoInicial: string;
  totales: TotalesCaja;
}

export async function obtenerCajaAbierta(depositoId: string): Promise<CajaAbierta | null> {
  const caja = await prisma.caja.findFirst({
    where: { depositoId, estado: EstadoCaja.ABIERTA },
    include: { deposito: { select: { nombre: true } }, abiertaPor: { select: { nombre: true } } },
  });
  if (!caja) return null;
  const totales = (await totalesDe(prisma, [caja.id])).get(caja.id)!;
  return {
    id: caja.id,
    depositoId,
    deposito: caja.deposito.nombre,
    abiertaAt: caja.abiertaAt,
    abiertaPor: caja.abiertaPor.nombre,
    montoInicial: dec(caja.montoInicial),
    totales,
  };
}

/** Estado de la caja de cada depósito activo (dashboard y /caja). */
export async function estadoCajas(): Promise<
  { depositoId: string; deposito: string; caja: CajaAbierta | null; ultimoCierre: Date | null }[]
> {
  const [depositos, abiertas, cierres] = await Promise.all([
    prisma.deposito.findMany({
      where: { activo: true },
      orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }],
      select: { id: true, nombre: true },
    }),
    prisma.caja.findMany({
      where: { estado: EstadoCaja.ABIERTA },
      include: { abiertaPor: { select: { nombre: true } } },
    }),
    prisma.caja.groupBy({
      by: ["depositoId"],
      where: { estado: EstadoCaja.CERRADA },
      _max: { cerradaAt: true },
    }),
  ]);
  const totales = await totalesDe(
    prisma,
    abiertas.map((c) => c.id),
  );
  return depositos.map((d) => {
    const c = abiertas.find((a) => a.depositoId === d.id);
    return {
      depositoId: d.id,
      deposito: d.nombre,
      caja: c
        ? {
            id: c.id,
            depositoId: d.id,
            deposito: d.nombre,
            abiertaAt: c.abiertaAt,
            abiertaPor: c.abiertaPor.nombre,
            montoInicial: dec(c.montoInicial),
            totales: totales.get(c.id)!,
          }
        : null,
      ultimoCierre: cierres.find((x) => x.depositoId === d.id)?._max.cerradaAt ?? null,
    };
  });
}

// =============================================================================
// Apertura, retiros, ingresos, cierre
// =============================================================================

function esCajaYaAbierta(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return true;
    if (e.code === "P2010") return (e.meta as { code?: string } | undefined)?.code === "23505";
  }
  return false;
}

export async function abrirCaja(
  input: { depositoId: string; montoInicial: number },
  actor: Actor,
): Promise<{ id: string }> {
  try {
    return await withTransaction(async (tx) => {
      const dep = await tx.deposito.findUnique({
        where: { id: input.depositoId },
        select: { nombre: true, activo: true },
      });
      if (!dep) throw new NotFoundError("El depósito no existe");
      if (!dep.activo) throw new DomainError(`El depósito "${dep.nombre}" está inactivo`);
      const montoInicial = D(input.montoInicial);
      const caja = await tx.caja.create({
        data: {
          depositoId: input.depositoId,
          abiertaPorId: actor.id,
          abiertaAt: ahora(),
          montoInicial,
        },
      });
      await registrarMovimientoCaja(tx, {
        cajaId: caja.id,
        tipo: TipoMovimientoCaja.APERTURA,
        monto: montoInicial,
        descripcion: "Apertura de caja",
        usuarioId: actor.id,
      });
      await registrarAuditoria(tx, {
        usuarioId: actor.id,
        accion: AccionAuditoria.CREATE,
        entidad: "Caja",
        entidadId: caja.id,
        datosDespues: { deposito: dep.nombre, montoInicial: dec(montoInicial) },
        meta: actor.meta,
      });
      return { id: caja.id };
    });
  } catch (e) {
    if (!esCajaYaAbierta(e)) throw e;
    // El índice único parcial lo garantiza aunque dos personas abran a la vez.
    const abierta = await prisma.caja.findFirst({
      where: { depositoId: input.depositoId, estado: EstadoCaja.ABIERTA },
      include: { abiertaPor: { select: { nombre: true } }, deposito: { select: { nombre: true } } },
    });
    throw new DomainError(
      abierta
        ? `La caja de ${abierta.deposito.nombre} ya está abierta (la abrió ${abierta.abiertaPor.nombre}). Cerrala antes de abrir otra.`
        : "Ya hay una caja abierta en ese depósito.",
      "CAJA_YA_ABIERTA",
      409,
    );
  }
}

async function bloquearCajaAbierta(tx: Tx, cajaId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Caja" WHERE "id" = ${cajaId} FOR UPDATE`;
  const caja = await tx.caja.findUnique({
    where: { id: cajaId },
    include: { deposito: { select: { nombre: true } } },
  });
  if (!caja) throw new NotFoundError("La caja no existe");
  if (caja.estado !== EstadoCaja.ABIERTA) throw new DomainError("La caja ya está cerrada.");
  return caja;
}

async function movimientoManual(
  tipo: typeof TipoMovimientoCaja.RETIRO | typeof TipoMovimientoCaja.INGRESO_EXTRA,
  input: { cajaId: string; monto: number; descripcion: string },
  actor: Actor,
) {
  return withTransaction(async (tx) => {
    const caja = await bloquearCajaAbierta(tx, input.cajaId);
    const monto = D(input.monto);
    if (tipo === TipoMovimientoCaja.RETIRO) {
      await verificarEfectivoDisponible(tx, caja.id, monto, "retirar");
    }
    const mov = await registrarMovimientoCaja(tx, {
      cajaId: caja.id,
      tipo,
      monto: tipo === TipoMovimientoCaja.RETIRO ? monto.neg() : monto,
      descripcion: input.descripcion,
      usuarioId: actor.id,
    });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.CREATE,
      entidad: "MovimientoCaja",
      entidadId: mov.id,
      datosDespues: {
        caja: caja.id,
        deposito: caja.deposito.nombre,
        tipo,
        monto: dec(monto),
        descripcion: input.descripcion,
      },
      meta: actor.meta,
    });
    return { id: mov.id };
  });
}

/** "Me llevé plata al banco". Solo OWNER (lo exige la acción). */
export function registrarRetiro(
  input: { cajaId: string; monto: number; descripcion: string },
  actor: Actor,
) {
  return movimientoManual(TipoMovimientoCaja.RETIRO, input, actor);
}

/** "Puse plata para cambio". */
export function registrarIngresoExtra(
  input: { cajaId: string; monto: number; descripcion: string },
  actor: Actor,
) {
  return movimientoManual(TipoMovimientoCaja.INGRESO_EXTRA, input, actor);
}

export interface CajaCerrada {
  id: string;
  deposito: string;
  montoEsperado: string;
  montoContado: string;
  diferencia: string;
  requiereRevision: boolean;
}

/**
 * Cierra la caja: la bloquea, calcula el esperado desde los movimientos,
 * guarda lo contado y la diferencia (contado − esperado), inserta el CIERRE
 * (retira lo contado) y la marca CERRADA. Si la diferencia supera la
 * tolerancia, exige observaciones y la deja para revisión.
 */
export async function cerrarCaja(
  cajaId: string,
  datos: { montoContado: number; observaciones?: string; conteo?: Record<string, number> },
  actor: Actor,
): Promise<CajaCerrada> {
  return withTransaction(
    async (tx) => {
      const caja = await bloquearCajaAbierta(tx, cajaId);
      const [suma] = await tx.$queryRaw<{ esperado: Prisma.Decimal | null }[]>`
        SELECT SUM("monto") AS esperado FROM "MovimientoCaja" WHERE "cajaId" = ${cajaId}
      `;
      const montoEsperado = D(suma?.esperado ?? 0);
      const montoContado = D(datos.montoContado);
      const diferencia = montoContado.minus(montoEsperado);
      const { toleranciaArqueo } = await obtenerConfigFinanzas(tx);
      const requiereRevision = diferencia.abs().greaterThan(toleranciaArqueo);
      const observaciones = datos.observaciones?.trim() || null;
      if (requiereRevision && !observaciones) {
        throw new ValidationError(
          `La diferencia (${$(diferencia)}) supera la tolerancia de ${formatearPesos(toleranciaArqueo)}: explicá qué pasó.`,
          { observaciones: ["Obligatorio cuando la diferencia supera la tolerancia"] },
        );
      }
      const momento = ahora();
      await registrarMovimientoCaja(tx, {
        cajaId,
        tipo: TipoMovimientoCaja.CIERRE,
        monto: montoContado.neg(),
        descripcion: `Cierre: contado ${$(montoContado)}`,
        usuarioId: actor.id,
      });
      await tx.caja.update({
        where: { id: cajaId },
        data: {
          estado: EstadoCaja.CERRADA,
          cerradaPorId: actor.id,
          cerradaAt: momento,
          montoEsperado,
          montoContado,
          diferencia,
          observaciones,
          requiereRevision,
        },
      });
      await registrarAuditoria(tx, {
        usuarioId: actor.id,
        accion: AccionAuditoria.UPDATE,
        entidad: "Caja",
        entidadId: cajaId,
        datosAntes: { estado: "ABIERTA" },
        datosDespues: {
          estado: "CERRADA",
          esperado: dec(montoEsperado),
          contado: dec(montoContado),
          diferencia: dec(diferencia),
          requiereRevision,
          conteo: datos.conteo ?? null,
        },
        meta: actor.meta,
      });
      return {
        id: cajaId,
        deposito: caja.deposito.nombre,
        montoEsperado: dec(montoEsperado),
        montoContado: dec(montoContado),
        diferencia: dec(diferencia),
        requiereRevision,
      };
    },
    { maxRetries: 3 },
  );
}

// =============================================================================
// Lectura
// =============================================================================

export interface CajaListada {
  id: string;
  deposito: string;
  estado: EstadoCaja;
  abiertaAt: Date;
  abiertaPor: string;
  cerradaAt: Date | null;
  cerradaPor: string | null;
  montoInicial: string;
  montoEsperado: string | null;
  montoContado: string | null;
  diferencia: string | null;
  requiereRevision: boolean;
  observaciones: string | null;
}

export async function listarCajas(
  f: FiltrosCajas,
  tz: string,
): Promise<{ cajas: CajaListada[]; total: number; page: number; pageSize: number }> {
  const where: Prisma.CajaWhereInput = {};
  if (f.depositoId) where.depositoId = f.depositoId;
  if (f.conDiferencia) where.diferencia = { not: 0 };
  if (f.desde || f.hasta) {
    const { inicio, fin } = limitesRango(f.desde ?? "2000-01-01", f.hasta ?? "2999-12-31", tz);
    where.abiertaAt = { gte: inicio, lt: fin };
  }
  const [total, filas] = await Promise.all([
    prisma.caja.count({ where }),
    prisma.caja.findMany({
      where,
      orderBy: { abiertaAt: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: {
        deposito: { select: { nombre: true } },
        abiertaPor: { select: { nombre: true } },
        cerradaPor: { select: { nombre: true } },
      },
    }),
  ]);
  return {
    cajas: filas.map((c) => ({
      id: c.id,
      deposito: c.deposito.nombre,
      estado: c.estado,
      abiertaAt: c.abiertaAt,
      abiertaPor: c.abiertaPor.nombre,
      cerradaAt: c.cerradaAt,
      cerradaPor: c.cerradaPor?.nombre ?? null,
      montoInicial: dec(c.montoInicial),
      montoEsperado: c.montoEsperado ? dec(c.montoEsperado) : null,
      montoContado: c.montoContado ? dec(c.montoContado) : null,
      diferencia: c.diferencia ? dec(c.diferencia) : null,
      requiereRevision: c.requiereRevision,
      observaciones: c.observaciones,
    })),
    total,
    page: f.page,
    pageSize: f.pageSize,
  };
}

function hrefReferencia(tipo: string | null, id: string | null): string | null {
  if (!tipo || !id) return null;
  if (tipo === "VENTA") return `/ventas/${id}`;
  if (tipo === "CLIENTE") return `/clientes/${id}`;
  if (tipo === "GASTO") return `/gastos?gasto=${id}`;
  return null;
}

export async function obtenerCaja(id: string) {
  const caja = await prisma.caja.findUnique({
    where: { id },
    include: {
      deposito: { select: { id: true, nombre: true } },
      abiertaPor: { select: { nombre: true } },
      cerradaPor: { select: { nombre: true } },
      movimientos: {
        orderBy: { createdAt: "asc" },
        include: { usuario: { select: { nombre: true } } },
      },
    },
  });
  if (!caja) throw new NotFoundError("La caja no existe");
  const totales = (await totalesDe(prisma, [id])).get(id)!;
  return {
    id: caja.id,
    deposito: caja.deposito,
    estado: caja.estado,
    abiertaAt: caja.abiertaAt,
    abiertaPor: caja.abiertaPor.nombre,
    cerradaAt: caja.cerradaAt,
    cerradaPor: caja.cerradaPor?.nombre ?? null,
    montoInicial: dec(caja.montoInicial),
    montoEsperado: caja.montoEsperado ? dec(caja.montoEsperado) : null,
    montoContado: caja.montoContado ? dec(caja.montoContado) : null,
    diferencia: caja.diferencia ? dec(caja.diferencia) : null,
    requiereRevision: caja.requiereRevision,
    observaciones: caja.observaciones,
    totales,
    movimientos: caja.movimientos.map((m) => ({
      id: m.id,
      tipo: m.tipo,
      etiqueta: ETIQUETA_MOVIMIENTO_CAJA[m.tipo],
      monto: dec(m.monto),
      descripcion: m.descripcion,
      usuario: m.usuario.nombre,
      fecha: m.createdAt,
      href: hrefReferencia(m.referenciaTipo, m.referenciaId),
    })),
  };
}

export type CajaDetalle = Awaited<ReturnType<typeof obtenerCaja>>;

/**
 * Datos del "Z de caja": apertura, cobros por medio de pago en el período de
 * la caja (efectivo desde la caja; el resto desde PagoVenta del mismo período
 * y depósito), gastos, retiros, esperado/contado/diferencia, ventas anuladas
 * del período y quién abrió y cerró.
 */
export async function reporteCierre(cajaId: string) {
  const caja = await obtenerCaja(cajaId);
  const desde = caja.abiertaAt;
  const hasta = caja.cerradaAt ?? ahora();
  const [medios, fueraDeCaja, anuladas, gastos] = await Promise.all([
    prisma.$queryRaw<{ medioPago: MedioPago; total: Prisma.Decimal; n: bigint }[]>`
      SELECT p."medioPago", SUM(p."monto") AS total, COUNT(*) AS n
      FROM "PagoVenta" p JOIN "Venta" v ON v."id" = p."ventaId"
      WHERE NOT p."anulado" AND v."depositoId" = ${caja.deposito.id}
        AND p."fecha" >= ${utc(desde)} AND p."fecha" <= ${utc(hasta)}
        AND (p."medioPago" <> 'EFECTIVO' OR p."cajaId" = ${cajaId})
      GROUP BY p."medioPago" ORDER BY total DESC
    `,
    prisma.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT SUM(p."monto") AS total
      FROM "PagoVenta" p JOIN "Venta" v ON v."id" = p."ventaId"
      WHERE NOT p."anulado" AND p."medioPago" = 'EFECTIVO' AND p."cajaId" IS NULL
        AND v."depositoId" = ${caja.deposito.id}
        AND p."fecha" >= ${utc(desde)} AND p."fecha" <= ${utc(hasta)}
    `,
    prisma.venta.findMany({
      where: { depositoId: caja.deposito.id, anuladaAt: { gte: desde, lte: hasta } },
      orderBy: { anuladaAt: "asc" },
      select: {
        id: true,
        numero: true,
        total: true,
        motivoAnulacion: true,
        anuladaPor: { select: { nombre: true } },
      },
    }),
    prisma.gasto.findMany({
      where: { cajaId, deletedAt: null },
      orderBy: { fecha: "asc" },
      select: { descripcion: true, monto: true, categoria: { select: { nombre: true } } },
    }),
  ]);
  return {
    caja,
    periodo: { desde, hasta },
    porMedioPago: medios.map((m) => ({
      medioPago: m.medioPago,
      total: dec(D(m.total)),
      cantidad: Number(m.n),
    })),
    efectivoFueraDeCaja: dec(D(fueraDeCaja[0]?.total ?? 0)),
    ventasAnuladas: anuladas.map((v) => ({
      id: v.id,
      numero: v.numero,
      total: dec(v.total),
      motivo: v.motivoAnulacion,
      por: v.anuladaPor?.nombre ?? "",
    })),
    gastos: gastos.map((g) => ({
      descripcion: g.descripcion,
      categoria: g.categoria.nombre,
      monto: dec(g.monto),
    })),
    retiros: caja.movimientos.filter((m) => m.tipo === TipoMovimientoCaja.RETIRO),
    ingresosExtra: caja.movimientos.filter((m) => m.tipo === TipoMovimientoCaja.INGRESO_EXTRA),
  };
}

export type ReporteCierre = Awaited<ReturnType<typeof reporteCierre>>;
