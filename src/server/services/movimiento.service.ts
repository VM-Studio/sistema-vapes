import { randomUUID } from "node:crypto";

import {
  AccionAuditoria,
  EstadoTransferencia,
  Prisma,
  RolUsuario,
  TipoMovimiento,
} from "@prisma/client";

import type {
  AjusteMasivo,
  Ajuste,
  FiltrosMovimientos,
  IngresoManual,
} from "@/lib/validations/movimiento";
import { formatearIdCompra, formatearIdVenta, rutaPanel } from "@/lib/paneles";
import type { CrearTransferencia } from "@/lib/validations/transferencia";
import { nombreConSabor } from "@/lib/ventas-ui";
import { siguienteNumero } from "@/server/db/secuencia";
import { dbPara, enTransaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { DomainError, NotFoundError, StockInsuficienteError } from "@/server/errors";
import { registrarAuditoria } from "@/server/services/audit.service";
import {
  bloquearStock,
  registrarMovimiento,
  signoMovimiento,
  transferirStock,
} from "@/server/services/stock.service";

/**
 * MOVIMIENTOS: ledger, ingresos manuales, ajustes y transferencias de UN panel.
 * Regla de oro: el stock SOLO cambia vía registrarMovimiento / transferirStock
 * (motor de stock). Acá no hay ni un update a Stock.
 * Todo recibe `ctx` primero: lecturas con dbPara(ctx.panelId), escrituras con
 * transaccion(ctx, ...). Un depósito o variante de otro panel da "no existe".
 */

// =============================================================================
// Ledger
// =============================================================================

export interface ReferenciaMovimiento {
  tipo: string;
  id: string;
  etiqueta: string;
  /** Ruta completa (/p/{slug}/...) a la pantalla del documento, cuando existe. */
  href: string | null;
}

export interface MovimientoListado {
  id: string;
  fecha: Date;
  tipo: TipoMovimiento;
  /** Cantidad con signo (+ entra, − sale). */
  cantidad: number;
  stockAnterior: number;
  stockPosterior: number;
  varianteId: string;
  productoId: string;
  nombre: string;
  sku: string;
  depositoId: string;
  deposito: string;
  usuario: string;
  /** Solo para dueños (opciones.incluirCostos); null para el resto. */
  costoUnitario: string | null;
  motivo: string | null;
  referencia: ReferenciaMovimiento | null;
}

function whereMovimientos(f: FiltrosMovimientos): Prisma.MovimientoStockWhereInput {
  const where: Prisma.MovimientoStockWhereInput = {};
  if (f.varianteId) where.varianteId = f.varianteId;
  if (f.productoId) where.variante = { productoId: f.productoId };
  if (f.depositoId) where.depositoId = f.depositoId;
  if (f.usuarioId) where.usuarioId = f.usuarioId;
  if (f.tipo) where.tipo = f.tipo;
  if (f.referenciaTipo) where.referenciaTipo = f.referenciaTipo;
  if (f.referenciaId) where.referenciaId = f.referenciaId;
  if (f.desde || f.hasta) {
    where.createdAt = {
      ...(f.desde ? { gte: f.desde } : {}),
      ...(f.hasta ? { lte: f.hasta } : {}),
    };
  }
  return where;
}

/** Etiquetas y links de referencias, resueltos en lote (sin N+1). */
async function resolverReferencias(
  ctx: Ctx,
  movs: { referenciaTipo: string | null; referenciaId: string | null }[],
): Promise<Map<string, ReferenciaMovimiento>> {
  const db = dbPara(ctx.panelId);
  const ids = (tipo: string) => [
    ...new Set(movs.filter((m) => m.referenciaTipo === tipo).map((m) => m.referenciaId!)),
  ];
  const mapa = new Map<string, ReferenciaMovimiento>();
  if (!movs.some((m) => m.referenciaTipo && m.referenciaId)) return mapa;
  const [panel, transf, ventas, compras, devoluciones] = await Promise.all([
    db.panel.findUniqueOrThrow({ where: { id: ctx.panelId }, select: { slug: true } }),
    db.transferencia.findMany({
      where: { id: { in: ids("TRANSFERENCIA") } },
      select: { id: true, numero: true },
    }),
    db.venta.findMany({
      where: { id: { in: ids("VENTA") } },
      select: { id: true, numero: true },
    }),
    db.compra.findMany({
      where: { id: { in: ids("COMPRA") } },
      select: { id: true, numero: true },
    }),
    db.devolucion.findMany({
      where: { id: { in: ids("DEVOLUCION") } },
      select: { id: true, numero: true, ventaId: true, venta: { select: { numero: true } } },
    }),
  ]);
  const ruta = (r: string) => rutaPanel(panel.slug, r);
  for (const t of transf) {
    mapa.set(`TRANSFERENCIA:${t.id}`, {
      tipo: "TRANSFERENCIA",
      id: t.id,
      etiqueta: `Transferencia #${t.numero}`,
      href: ruta(`/stock/movimientos/transferencias/${t.id}`),
    });
  }
  for (const v of ventas)
    mapa.set(`VENTA:${v.id}`, {
      tipo: "VENTA",
      id: v.id,
      etiqueta: `Venta ${formatearIdVenta(panel.slug, v.numero)}`,
      href: ruta(`/ventas/${v.id}`),
    });
  for (const d of devoluciones)
    mapa.set(`DEVOLUCION:${d.id}`, {
      tipo: "DEVOLUCION",
      id: d.id,
      etiqueta: `Devolución #${d.numero} (venta ${formatearIdVenta(panel.slug, d.venta.numero)})`,
      href: ruta(`/ventas/${d.ventaId}`),
    });
  for (const c of compras)
    mapa.set(`COMPRA:${c.id}`, {
      tipo: "COMPRA",
      id: c.id,
      etiqueta: `Compra ${formatearIdCompra(panel.slug, c.numero)}`,
      href: ruta(`/compras/${c.id}`),
    });
  for (const m of movs) {
    if (m.referenciaTipo === "AJUSTE" && m.referenciaId) {
      mapa.set(`AJUSTE:${m.referenciaId}`, {
        tipo: "AJUSTE",
        id: m.referenciaId,
        etiqueta: "Ajuste / recuento",
        href: null,
      });
    }
  }
  return mapa;
}

/**
 * Ledger del panel paginado, más nuevo primero, con producto, variante,
 * depósito y usuario. Filtrable por depósito (sin depósito = todos).
 * El costo unitario solo viaja si `incluirCostos` (dueños).
 */
export async function listarMovimientos(
  ctx: Ctx,
  filtros: FiltrosMovimientos,
  opciones: { incluirCostos?: boolean } = {},
): Promise<{ movimientos: MovimientoListado[]; total: number; page: number; pageSize: number }> {
  const db = dbPara(ctx.panelId);
  const where = whereMovimientos(filtros);
  const [total, filas] = await Promise.all([
    db.movimientoStock.count({ where }),
    db.movimientoStock.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filtros.page - 1) * filtros.pageSize,
      take: filtros.pageSize,
      include: {
        variante: {
          select: {
            nombre: true,
            sku: true,
            productoId: true,
            producto: { select: { nombreCompleto: true } },
          },
        },
        deposito: { select: { nombre: true } },
        usuario: { select: { nombre: true } },
      },
    }),
  ]);
  const refs = await resolverReferencias(ctx, filas);
  return {
    movimientos: filas.map((m) => ({
      id: m.id,
      fecha: m.createdAt,
      tipo: m.tipo,
      cantidad: signoMovimiento(m.tipo) * m.cantidad,
      stockAnterior: m.stockAnterior,
      stockPosterior: m.stockPosterior,
      varianteId: m.varianteId,
      productoId: m.variante.productoId,
      nombre: nombreConSabor(m.variante.producto.nombreCompleto, m.variante.nombre),
      sku: m.variante.sku,
      depositoId: m.depositoId,
      deposito: m.deposito.nombre,
      usuario: m.usuario.nombre,
      costoUnitario: opciones.incluirCostos && m.costoUnitario ? m.costoUnitario.toFixed(2) : null,
      motivo: m.motivo,
      referencia:
        m.referenciaTipo && m.referenciaId
          ? (refs.get(`${m.referenciaTipo}:${m.referenciaId}`) ?? null)
          : null,
    })),
    total,
    page: filtros.page,
    pageSize: filtros.pageSize,
  };
}

// =============================================================================
// Helpers de validación
// =============================================================================

async function depositoActivo(tx: Tx, id: string, rol = "El depósito") {
  const d = await tx.deposito.findUnique({
    where: { id },
    select: { id: true, nombre: true, activo: true },
  });
  if (!d) throw new NotFoundError(`${rol} no existe`);
  if (!d.activo) throw new DomainError(`${rol} "${d.nombre}" está inactivo`);
  return d;
}

async function variantesVivas(tx: Tx, ids: string[]) {
  const vs = await tx.variante.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: {
      id: true,
      nombre: true,
      ultimoCosto: true,
      producto: { select: { nombreCompleto: true } },
    },
  });
  if (vs.length !== new Set(ids).size)
    throw new NotFoundError("Alguno de los productos no existe o fue dado de baja");
  return new Map(
    vs.map((v) => [
      v.id,
      {
        ...v,
        nombreCompleto: nombreConSabor(v.producto.nombreCompleto, v.nombre),
      },
    ]),
  );
}

/** Los costos solo los informa (y los ve) un dueño. */
async function esDuenio(tx: Tx, usuarioId: string): Promise<boolean> {
  const u = await tx.usuario.findUnique({ where: { id: usuarioId }, select: { rol: true } });
  return u?.rol === RolUsuario.OWNER;
}

/** Ordenar por varianteId: todas las operaciones bloquean filas de Stock en el mismo orden (sin deadlocks). */
const porVariante = <T extends { varianteId: string }>(items: T[]) =>
  [...items].sort((a, b) => a.varianteId.localeCompare(b.varianteId));

// =============================================================================
// Ingreso manual
// =============================================================================

/**
 * Carga inicial o entrada sin proveedor. Una transacción, un movimiento
 * INGRESO_MANUAL por ítem. Costos: solo si quien carga es dueño; si
 * `actualizarCosto` y el costo informado difiere del último costo de la
 * variante, lo actualiza (es el que tomarán las próximas ventas). Si no es dueño, se ignoran y el movimiento lleva el costo vigente.
 */
export async function registrarIngresoManual(
  ctx: Ctx,
  input: IngresoManual,
  txExterna?: Tx,
): Promise<{ movimientos: number; unidades: number; costosActualizados: number }> {
  return enTransaccion(
    ctx,
    txExterna,
    async (tx) => {
      await depositoActivo(tx, input.depositoId);
      const variantes = await variantesVivas(
        tx,
        input.items.map((i) => i.varianteId),
      );
      const conCostos =
        input.items.some((i) => i.costoUnitario !== undefined) &&
        (await esDuenio(tx, ctx.usuarioId));

      let costosActualizados = 0;
      for (const item of porVariante(input.items)) {
        const v = variantes.get(item.varianteId)!;
        const costoInformado = conCostos ? item.costoUnitario : undefined;
        await registrarMovimiento(tx, {
          tipo: TipoMovimiento.INGRESO_MANUAL,
          varianteId: item.varianteId,
          depositoId: input.depositoId,
          cantidad: item.cantidad,
          costoUnitario: costoInformado ?? v.ultimoCosto,
          motivo: input.motivo,
          usuarioId: ctx.usuarioId,
        });
        if (
          input.actualizarCosto &&
          costoInformado !== undefined &&
          (v.ultimoCosto === null || !new Prisma.Decimal(costoInformado).equals(v.ultimoCosto))
        ) {
          await tx.variante.update({
            where: { id: item.varianteId },
            data: { ultimoCosto: costoInformado },
          });
          await registrarAuditoria(tx, {
            usuarioId: ctx.usuarioId,
            accion: AccionAuditoria.UPDATE,
            entidad: "Variante",
            entidadId: item.varianteId,
            datosAntes: { ultimoCosto: v.ultimoCosto?.toFixed(2) ?? null },
            datosDespues: {
              ultimoCosto: new Prisma.Decimal(costoInformado).toFixed(2),
              motivo: `Ingreso manual: ${input.motivo}`,
            },
            meta: ctx.meta,
          });
          costosActualizados++;
        }
      }

      const unidades = input.items.reduce((a, i) => a + i.cantidad, 0);
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.CREATE,
        entidad: "IngresoManual",
        datosDespues: {
          depositoId: input.depositoId,
          motivo: input.motivo,
          items: input.items.map((i) => ({
            varianteId: i.varianteId,
            cantidad: i.cantidad,
            costoUnitario: conCostos ? (i.costoUnitario ?? null) : null,
          })),
          costosActualizados,
        },
        meta: ctx.meta,
      });
      return { movimientos: input.items.length, unidades, costosActualizados };
    },
    { timeout: 60_000 },
  );
}

// =============================================================================
// Ajustes (el usuario informa el conteo real; se ajusta la diferencia)
// =============================================================================

export interface ResultadoAjuste {
  varianteId: string;
  nombre: string;
  stockAnterior: number;
  cantidadReal: number;
  diferencia: number;
}

async function ajustarUno(
  ctx: Ctx,
  tx: Tx,
  depositoId: string,
  varianteId: string,
  cantidadReal: number,
  motivo: string,
  referenciaId: string,
): Promise<{ stockAnterior: number; diferencia: number }> {
  const filas = await bloquearStock(tx, ctx.panelId, varianteId, [depositoId]);
  const stockAnterior = filas.get(depositoId)?.cantidad ?? 0;
  const diferencia = cantidadReal - stockAnterior;
  if (diferencia !== 0) {
    await registrarMovimiento(tx, {
      tipo: diferencia > 0 ? TipoMovimiento.AJUSTE_POSITIVO : TipoMovimiento.AJUSTE_NEGATIVO,
      varianteId,
      depositoId,
      cantidad: Math.abs(diferencia),
      motivo,
      referenciaTipo: "AJUSTE",
      referenciaId,
      usuarioId: ctx.usuarioId,
    });
  }
  return { stockAnterior, diferencia };
}

/**
 * Ajuste simple: conteo real de una variante en un depósito. Genera
 * AJUSTE_POSITIVO o AJUSTE_NEGATIVO por la diferencia contra el stock actual
 * (leído con bloqueo dentro de la transacción: no se pisa con una venta).
 */
export async function registrarAjuste(
  ctx: Ctx,
  input: Ajuste,
  txExterna?: Tx,
): Promise<ResultadoAjuste> {
  return enTransaccion(ctx, txExterna, async (tx) => {
    await depositoActivo(tx, input.depositoId);
    const v = (await variantesVivas(tx, [input.varianteId])).get(input.varianteId)!;
    const referenciaId = randomUUID();
    const { stockAnterior, diferencia } = await ajustarUno(
      ctx,
      tx,
      input.depositoId,
      input.varianteId,
      input.cantidadReal,
      input.motivo,
      referenciaId,
    );
    if (diferencia === 0) {
      throw new DomainError(
        `El sistema ya tiene ${stockAnterior} unidades de ${v.nombreCompleto}: no hay nada que ajustar.`,
      );
    }
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.CREATE,
      entidad: "Ajuste",
      entidadId: referenciaId,
      datosDespues: {
        depositoId: input.depositoId,
        varianteId: input.varianteId,
        stockAnterior,
        cantidadReal: input.cantidadReal,
        diferencia,
        motivo: input.motivo,
      },
      meta: ctx.meta,
    });
    return {
      varianteId: input.varianteId,
      nombre: v.nombreCompleto,
      stockAnterior,
      cantidadReal: input.cantidadReal,
      diferencia,
    };
  });
}

/**
 * Recuento físico: conteo real de varias variantes de un depósito. Solo genera
 * ajustes donde hay diferencia; todos comparten referencia (un "recuento").
 */
export async function registrarAjusteMasivo(
  ctx: Ctx,
  input: AjusteMasivo,
  txExterna?: Tx,
): Promise<{ referenciaId: string; ajustes: ResultadoAjuste[]; sinCambios: number }> {
  return enTransaccion(
    ctx,
    txExterna,
    async (tx) => {
      await depositoActivo(tx, input.depositoId);
      const variantes = await variantesVivas(
        tx,
        input.items.map((i) => i.varianteId),
      );
      const referenciaId = randomUUID();
      const ajustes: ResultadoAjuste[] = [];
      let sinCambios = 0;
      for (const item of porVariante(input.items)) {
        const { stockAnterior, diferencia } = await ajustarUno(
          ctx,
          tx,
          input.depositoId,
          item.varianteId,
          item.cantidadReal,
          input.motivo,
          referenciaId,
        );
        if (diferencia === 0) sinCambios++;
        else
          ajustes.push({
            varianteId: item.varianteId,
            nombre: variantes.get(item.varianteId)!.nombreCompleto,
            stockAnterior,
            cantidadReal: item.cantidadReal,
            diferencia,
          });
      }
      if (ajustes.length === 0)
        throw new DomainError(
          "El conteo coincide con el sistema en todos los productos: no hay nada que ajustar.",
        );
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.CREATE,
        entidad: "Ajuste",
        entidadId: referenciaId,
        datosDespues: {
          tipo: "recuento",
          depositoId: input.depositoId,
          motivo: input.motivo,
          ajustes: ajustes.map((a) => ({ ...a })),
          sinCambios,
        },
        meta: ctx.meta,
      });
      return { referenciaId, ajustes, sinCambios };
    },
    { timeout: 60_000 },
  );
}

export interface StockParaRecuento {
  varianteId: string;
  nombre: string;
  sku: string;
  codigoBarras: string | null;
  stockSistema: number;
}

/** Variantes con stock en el depósito (o todas las activas) para la planilla de recuento. */
export async function listarStockParaRecuento(
  ctx: Ctx,
  depositoId: string,
  incluirSinStock = false,
): Promise<StockParaRecuento[]> {
  const variantes = await dbPara(ctx.panelId).variante.findMany({
    where: {
      deletedAt: null,
      producto: { deletedAt: null },
      ...(incluirSinStock
        ? { activo: true }
        : { stocks: { some: { depositoId, cantidad: { gt: 0 } } } }),
    },
    orderBy: [{ producto: { nombreCompleto: "asc" } }, { nombre: "asc" }],
    select: {
      id: true,
      nombre: true,
      sku: true,
      codigoBarras: true,
      producto: { select: { nombreCompleto: true } },
      stocks: { where: { depositoId }, select: { cantidad: true } },
    },
  });
  return variantes.map((v) => ({
    varianteId: v.id,
    nombre: nombreConSabor(v.producto.nombreCompleto, v.nombre),
    sku: v.sku,
    codigoBarras: v.codigoBarras,
    stockSistema: v.stocks[0]?.cantidad ?? 0,
  }));
}

// =============================================================================
// Transferencias (entre depósitos del mismo panel)
// =============================================================================

async function faltantes(
  tx: Tx,
  depositoId: string,
  items: { varianteId: string; cantidad: number }[],
  nombres: Map<string, { nombreCompleto: string }>,
): Promise<string[]> {
  const stocks = await tx.stock.findMany({
    where: { depositoId, varianteId: { in: items.map((i) => i.varianteId) } },
    select: { varianteId: true, cantidad: true },
  });
  const disp = new Map(stocks.map((s) => [s.varianteId, s.cantidad]));
  return items
    .filter((i) => (disp.get(i.varianteId) ?? 0) < i.cantidad)
    .map(
      (i) =>
        `${nombres.get(i.varianteId)?.nombreCompleto ?? i.varianteId}: hay ${disp.get(i.varianteId) ?? 0}, se piden ${i.cantidad}`,
    );
}

/** Bloquea la fila de la transferencia (SQL cruda: filtra el panel a mano). */
async function bloquearTransferencia(ctx: Ctx, tx: Tx, id: string): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "Transferencia"
    WHERE "id" = ${id} AND "panelId" = ${ctx.panelId}
    FOR UPDATE`;
}

/**
 * Crea la transferencia PENDIENTE con el próximo número del panel. Valida que
 * HOY haya stock en origen (solo valida: no mueve nada hasta completarla).
 * Origen y destino tienen que ser depósitos del panel (el tx no ve otros).
 */
export async function crearTransferencia(
  ctx: Ctx,
  input: CrearTransferencia,
  txExterna?: Tx,
): Promise<{ id: string; numero: number }> {
  return enTransaccion(ctx, txExterna, async (tx) => {
    const origen = await depositoActivo(tx, input.depositoOrigenId, "El depósito de origen");
    await depositoActivo(tx, input.depositoDestinoId, "El depósito de destino");
    const variantes = await variantesVivas(
      tx,
      input.items.map((i) => i.varianteId),
    );
    const sinStock = await faltantes(tx, input.depositoOrigenId, input.items, variantes);
    if (sinStock.length) {
      throw new DomainError(
        `Stock insuficiente en ${origen.nombre}. ${sinStock.join(" · ")}`,
        "STOCK_INSUFICIENTE",
        409,
      );
    }
    const numero = await siguienteNumero(tx, ctx.panelId, "TRANSFERENCIA");
    const t = await tx.transferencia.create({
      data: {
        numero,
        depositoOrigenId: input.depositoOrigenId,
        depositoDestinoId: input.depositoDestinoId,
        estado: EstadoTransferencia.PENDIENTE,
        fecha: input.fecha ?? new Date(),
        notas: input.notas ?? null,
        usuarioId: ctx.usuarioId,
        items: {
          create: input.items.map((i) => ({ varianteId: i.varianteId, cantidad: i.cantidad })),
        },
      },
    });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.CREATE,
      entidad: "Transferencia",
      entidadId: t.id,
      datosDespues: {
        numero: t.numero,
        origen: input.depositoOrigenId,
        destino: input.depositoDestinoId,
        items: input.items.map((i) => ({ ...i })),
      },
      meta: ctx.meta,
    });
    return { id: t.id, numero: t.numero };
  });
}

/**
 * Completa la transferencia: por cada ítem, transferirStock (SALIDA + ENTRADA).
 * Transacción Serializable del panel. Si falta stock en cualquier ítem, falla
 * completa con el detalle de todos los faltantes y queda PENDIENTE.
 */
export async function completarTransferencia(
  ctx: Ctx,
  id: string,
  txExterna?: Tx,
): Promise<{ numero: number; unidades: number }> {
  return enTransaccion(
    ctx,
    txExterna,
    async (tx) => {
      // Bloquea la transferencia: dos "Completar" simultáneos no la aplican dos veces.
      await bloquearTransferencia(ctx, tx, id);
      const t = await tx.transferencia.findUnique({ where: { id }, include: { items: true } });
      if (!t) throw new NotFoundError("La transferencia no existe");
      if (t.estado !== EstadoTransferencia.PENDIENTE) {
        throw new DomainError(
          `La transferencia #${t.numero} está ${t.estado.toLowerCase()}: solo se completan las pendientes.`,
        );
      }
      const origen = await depositoActivo(tx, t.depositoOrigenId, "El depósito de origen");
      await depositoActivo(tx, t.depositoDestinoId, "El depósito de destino");
      const items = porVariante(t.items);
      const variantes = await variantesVivas(
        tx,
        items.map((i) => i.varianteId),
      );

      // Bloquear todo primero (orden fijo) y reportar todos los faltantes juntos.
      for (const i of items)
        await bloquearStock(tx, ctx.panelId, i.varianteId, [
          t.depositoOrigenId,
          t.depositoDestinoId,
        ]);
      const sinStock = await faltantes(tx, t.depositoOrigenId, items, variantes);
      if (sinStock.length) {
        throw new DomainError(
          `No se pudo completar la transferencia #${t.numero}: stock insuficiente en ${origen.nombre}. ${sinStock.join(" · ")}. Sigue pendiente.`,
          "STOCK_INSUFICIENTE",
          409,
        );
      }

      try {
        for (const i of items) {
          await transferirStock(tx, {
            varianteId: i.varianteId,
            depositoOrigenId: t.depositoOrigenId,
            depositoDestinoId: t.depositoDestinoId,
            cantidad: i.cantidad,
            usuarioId: ctx.usuarioId,
            motivo: `Transferencia #${t.numero}`,
            referenciaId: t.id,
          });
        }
      } catch (e) {
        if (e instanceof StockInsuficienteError) {
          throw new DomainError(
            `No se pudo completar la transferencia #${t.numero}: ${e.message}. Sigue pendiente.`,
            "STOCK_INSUFICIENTE",
            409,
          );
        }
        throw e;
      }

      await tx.transferencia.update({
        where: { id },
        data: { estado: EstadoTransferencia.COMPLETADA, completadaAt: new Date() },
      });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Transferencia",
        entidadId: id,
        datosAntes: { estado: "PENDIENTE" },
        datosDespues: { estado: "COMPLETADA" },
        meta: ctx.meta,
      });
      return { numero: t.numero, unidades: items.reduce((a, i) => a + i.cantidad, 0) };
    },
    { timeout: 60_000, maxRetries: 2 },
  );
}

/** Anula una transferencia PENDIENTE (no movió stock, no hay nada que revertir). */
export async function anularTransferencia(
  ctx: Ctx,
  id: string,
  motivo: string,
  txExterna?: Tx,
): Promise<{ numero: number }> {
  return enTransaccion(ctx, txExterna, async (tx) => {
    await bloquearTransferencia(ctx, tx, id);
    const t = await tx.transferencia.findUnique({ where: { id } });
    if (!t) throw new NotFoundError("La transferencia no existe");
    if (t.estado !== EstadoTransferencia.PENDIENTE) {
      throw new DomainError(
        `La transferencia #${t.numero} está ${t.estado.toLowerCase()}: solo se anulan las pendientes.`,
      );
    }
    const notas = [t.notas, `[Anulada] ${motivo}`].filter(Boolean).join("\n");
    await tx.transferencia.update({
      where: { id },
      data: { estado: EstadoTransferencia.ANULADA, notas },
    });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "Transferencia",
      entidadId: id,
      datosAntes: { estado: "PENDIENTE" },
      datosDespues: { estado: "ANULADA", motivo },
      meta: ctx.meta,
    });
    return { numero: t.numero };
  });
}

export interface TransferenciaListada {
  id: string;
  numero: number;
  fecha: Date;
  estado: EstadoTransferencia;
  origen: string;
  destino: string;
  items: number;
  unidades: number;
  usuario: string;
  completadaAt: Date | null;
}

/** Transferencias del panel; con `depositoId`, las que salen o entran a ese depósito. */
export async function listarTransferencias(
  ctx: Ctx,
  filtros: {
    estado?: EstadoTransferencia;
    depositoId?: string;
    page: number;
    pageSize: number;
  },
): Promise<{
  transferencias: TransferenciaListada[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const db = dbPara(ctx.panelId);
  const where: Prisma.TransferenciaWhereInput = {
    ...(filtros.estado ? { estado: filtros.estado } : {}),
    ...(filtros.depositoId
      ? {
          OR: [{ depositoOrigenId: filtros.depositoId }, { depositoDestinoId: filtros.depositoId }],
        }
      : {}),
  };
  const [total, filas] = await Promise.all([
    db.transferencia.count({ where }),
    db.transferencia.findMany({
      where,
      orderBy: [{ numero: "desc" }],
      skip: (filtros.page - 1) * filtros.pageSize,
      take: filtros.pageSize,
      include: {
        depositoOrigen: { select: { nombre: true } },
        depositoDestino: { select: { nombre: true } },
        usuario: { select: { nombre: true } },
        items: { select: { cantidad: true } },
      },
    }),
  ]);
  return {
    transferencias: filas.map((t) => ({
      id: t.id,
      numero: t.numero,
      fecha: t.fecha,
      estado: t.estado,
      origen: t.depositoOrigen.nombre,
      destino: t.depositoDestino.nombre,
      items: t.items.length,
      unidades: t.items.reduce((a, i) => a + i.cantidad, 0),
      usuario: t.usuario.nombre,
      completadaAt: t.completadaAt,
    })),
    total,
    page: filtros.page,
    pageSize: filtros.pageSize,
  };
}

export interface TransferenciaDetalle extends Omit<TransferenciaListada, "items"> {
  depositoOrigenId: string;
  depositoDestinoId: string;
  notas: string | null;
  items: {
    varianteId: string;
    nombre: string;
    sku: string;
    cantidad: number;
    stockOrigen: number;
  }[];
}

export async function obtenerTransferencia(ctx: Ctx, id: string): Promise<TransferenciaDetalle> {
  const t = await dbPara(ctx.panelId).transferencia.findUnique({
    where: { id },
    include: {
      depositoOrigen: { select: { nombre: true } },
      depositoDestino: { select: { nombre: true } },
      usuario: { select: { nombre: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          variante: {
            select: {
              nombre: true,
              sku: true,
              producto: { select: { nombreCompleto: true } },
              stocks: { select: { depositoId: true, cantidad: true } },
            },
          },
        },
      },
    },
  });
  if (!t) throw new NotFoundError("La transferencia no existe");
  return {
    id: t.id,
    numero: t.numero,
    fecha: t.fecha,
    estado: t.estado,
    origen: t.depositoOrigen.nombre,
    destino: t.depositoDestino.nombre,
    depositoOrigenId: t.depositoOrigenId,
    depositoDestinoId: t.depositoDestinoId,
    usuario: t.usuario.nombre,
    completadaAt: t.completadaAt,
    notas: t.notas,
    unidades: t.items.reduce((a, i) => a + i.cantidad, 0),
    items: t.items.map((i) => ({
      varianteId: i.varianteId,
      nombre: nombreConSabor(i.variante.producto.nombreCompleto, i.variante.nombre),
      sku: i.variante.sku,
      cantidad: i.cantidad,
      stockOrigen:
        i.variante.stocks.find((s) => s.depositoId === t.depositoOrigenId)?.cantidad ?? 0,
    })),
  };
}
