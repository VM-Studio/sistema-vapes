import { randomUUID } from "node:crypto";

import { AccionAuditoria, Prisma, RolUsuario, TipoMovimiento } from "@prisma/client";

import type {
  AjusteMasivo,
  Ajuste,
  FiltrosMovimientos,
  IngresoManual,
} from "@/lib/validations/movimiento";
import { nombreConSabor } from "@/lib/ventas-ui";
import { enTransaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { DomainError, NotFoundError } from "@/server/errors";
import { registrarAuditoria } from "@/server/services/audit.service";
import {
  bloquearStock,
  movimientos,
  registrarMovimiento,
  type ResultadoLedger,
} from "@/server/services/stock.service";

/**
 * MOVIMIENTOS: ledger, ingresos manuales y ajustes de UN panel (las
 * transferencias entre galpones viven en transferencia.service.ts).
 * Regla de oro: el stock SOLO cambia vía registrarMovimiento / transferirStock
 * (motor de stock). Acá no hay ni un update a Stock.
 * Todo recibe `ctx` primero: lecturas con dbPara(ctx.panelId), escrituras con
 * transaccion(ctx, ...). Un depósito o variante de otro panel da "no existe".
 */

// =============================================================================
// Ledger (la lectura vive en stock.service; esto la expone con los filtros de la URL)
// =============================================================================

export type { MovimientoListado, ReferenciaMovimiento } from "@/server/services/stock.service";

/**
 * Ledger del panel paginado, más nuevo primero. Filtrable por galpón (sin
 * galpón = todos), sabor, producto, tipo, usuario, referencia y fechas.
 * El costo unitario solo viaja si `incluirCostos` (dueños).
 */
export async function listarMovimientos(
  ctx: Ctx,
  filtros: FiltrosMovimientos,
  opciones: { incluirCostos?: boolean } = {},
): Promise<ResultadoLedger> {
  return movimientos(ctx, filtros, opciones);
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
