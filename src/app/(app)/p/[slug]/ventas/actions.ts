"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { VarianteEncontrada } from "@/features/scanner/tipos";
import { puede } from "@/lib/permisos";
import { crearClienteSchema } from "@/lib/validations/cliente";
import { id } from "@/lib/validations/common";
import { anularVentaSchema, borradorVentaSchema, venderSchema } from "@/lib/validations/venta";
import { actionHandler } from "@/server/action-handler";
import { requireCtx, requireCtxAlguno, type CtxPanel } from "@/server/auth/permissions";
import {
  buscarClientesPos,
  crearCliente,
  obtenerClientePos,
} from "@/server/services/cliente.service";
import { buscarVariantes, obtenerVariantesPorId } from "@/server/services/producto.service";
import {
  actualizarBorrador,
  anularVenta,
  crearBorrador,
  descartarBorrador,
  productosRapidos,
  vender,
} from "@/server/services/venta.service";

/**
 * Permisos de VENTAS (en el panel actual):
 *   ver → listado y detalle · crear → vender (POS) y borradores
 *   editar → precio manual y descuento global · eliminar → anular ventas
 * Los precios, costos y totales los calcula el servicio: acá solo se decide qué puede el usuario.
 */

/** Una venta confirmada o anulada mueve stock y aparece en la ficha del cliente. */
function revalidar() {
  revalidatePath("/p/[slug]/ventas", "layout");
  revalidatePath("/p/[slug]/stock", "layout");
  revalidatePath("/p/[slug]/productos", "layout");
  revalidatePath("/p/[slug]/clientes", "layout");
}

const permisosDe = (ctx: CtxPanel) => ({
  puedeEditar: puede(ctx.usuario, ctx.panelId, Modulo.VENTAS, "editar"),
});

/** POS: guarda el borrador (nuevo o retomado) y lo confirma en una sola transacción. */
export const venderAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.VENTAS, "crear");
  const datos = venderSchema.parse(input);
  const r = await vender(ctx, datos, permisosDe(ctx));
  revalidar();
  return r;
});

/** Guardar como borrador (presupuesto / cliente que vuelve después). */
export const guardarBorradorAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.VENTAS, "crear");
  const { borradorId, venta } = z
    .object({ borradorId: id.optional(), venta: borradorVentaSchema })
    .parse(input);
  const r = borradorId
    ? await actualizarBorrador(ctx, borradorId, venta, permisosDe(ctx))
    : await crearBorrador(ctx, venta, permisosDe(ctx));
  revalidatePath("/p/[slug]/ventas", "page");
  return r;
});

export const descartarBorradorAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.VENTAS, "crear");
  const { ventaId } = z.object({ ventaId: id }).parse(input);
  await descartarBorrador(ctx, ventaId);
  revalidatePath("/p/[slug]/ventas", "page");
});

export const anularVentaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.VENTAS, "eliminar");
  const { ventaId, motivo } = anularVentaSchema.parse(input);
  const r = await anularVenta(ctx, ventaId, motivo);
  revalidar();
  return r;
});

// --- Datos para el POS (sin costos: el vendedor no los necesita) ---------------------

export interface VariantePos {
  varianteId: string;
  /** Producto + sabor ("Elf Bar BC 5000 — Mango Ice"). */
  nombreCompleto: string;
  sku: string;
  codigoBarras: string | null;
  /** Precio efectivo del sabor. */
  precioVenta: string;
  /** Stock en el depósito elegido. */
  stock: number;
}

function aPos(v: VarianteEncontrada, depositoId: string): VariantePos {
  return {
    varianteId: v.varianteId,
    nombreCompleto: v.titulo,
    sku: v.sku,
    codigoBarras: v.codigoBarras,
    precioVenta: v.precioVenta,
    stock: v.stockPorDeposito.find((s) => s.depositoId === depositoId)?.cantidad ?? 0,
  };
}

export const buscarProductosPosAction = actionHandler(
  async (input: unknown): Promise<VariantePos[]> => {
    const ctx = await requireCtx(Modulo.VENTAS, "crear");
    const { q, depositoId } = z.object({ q: z.string().max(100), depositoId: id }).parse(input);
    const r = await buscarVariantes(ctx, q, { depositoId, limite: 15 });
    return r.map((v) => aPos(v, depositoId));
  },
);

/** Precio y stock actuales de lo que está en el carrito (al cambiar de depósito y antes de cobrar). */
export const variantesPosAction = actionHandler(async (input: unknown): Promise<VariantePos[]> => {
  const ctx = await requireCtx(Modulo.VENTAS, "crear");
  const { ids, depositoId } = z.object({ ids: z.array(id).max(300), depositoId: id }).parse(input);
  const r = await obtenerVariantesPorId(ctx, ids, depositoId);
  return r.map((v) => aPos(v, depositoId));
});

export const productosRapidosAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.VENTAS, "crear");
  const { depositoId } = z.object({ depositoId: id }).parse(input);
  return productosRapidos(ctx, depositoId);
});

export const buscarClientesAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxAlguno([Modulo.VENTAS, Modulo.CLIENTES], "ver");
  const { q } = z.object({ q: z.string().max(100) }).parse(input);
  return buscarClientesPos(ctx, q);
});

export const clientePosAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxAlguno([Modulo.VENTAS, Modulo.CLIENTES], "ver");
  const { id: clienteId } = z.object({ id }).parse(input);
  return obtenerClientePos(ctx, clienteId);
});

/** "Crear rápido" desde el POS. */
export const crearClienteRapidoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxAlguno([Modulo.CLIENTES, Modulo.VENTAS], "crear");
  const c = await crearCliente(ctx, crearClienteSchema.parse(input));
  revalidatePath("/p/[slug]/clientes", "page");
  const pos = await obtenerClientePos(ctx, c.id);
  if (!pos) throw new Error("No se pudo leer el cliente recién creado");
  return pos;
});
