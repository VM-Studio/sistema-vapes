"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { id } from "@/lib/validations/common";
import {
  actualizarProveedorSchema,
  asignarProductoSchema,
  crearProductoDeProveedorSchema,
  crearProveedorSchema,
  quitarProductoSchema,
} from "@/lib/validations/proveedor";
import { actionHandler } from "@/server/action-handler";
import { puede } from "@/lib/permisos";
import { requireCtx } from "@/server/auth/permissions";
import { transaccion } from "@/server/db/panel-scoped";
import { ForbiddenError } from "@/server/errors";
import { crear as crearProducto } from "@/server/services/producto.service";
import {
  actualizar,
  asignarProducto,
  buscarProductosDelPanel,
  crear,
  desactivar,
  quitarProducto,
  veCostosCompras,
} from "@/server/services/proveedor.service";

/**
 * PROVEEDORES del panel: crear · editar (datos, activo y productos que vende)
 * · eliminar (desactivar). Cargar o cambiar PRECIOS de proveedor exige
 * además ver costos (dueño o `ver` en COMPRAS).
 */

const SIN_PRECIOS = "No tenés permiso para ver ni cargar precios de proveedores.";

function revalidar() {
  revalidatePath("/p/[slug]/proveedores", "layout");
  revalidatePath("/p/[slug]/compras", "layout");
}

export const crearProveedorAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PROVEEDORES, "crear");
  const datos = crearProveedorSchema.parse(input);
  if (datos.productos.length > 0 && !veCostosCompras(ctx)) throw new ForbiddenError(SIN_PRECIOS);
  const r = await crear(ctx, datos);
  revalidar();
  return r;
});

export const actualizarProveedorAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PROVEEDORES, "editar");
  const r = await actualizar(ctx, actualizarProveedorSchema.parse(input));
  revalidar();
  return r;
});

export const desactivarProveedorAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PROVEEDORES, "eliminar");
  const { id: proveedorId } = z.object({ id }).parse(input);
  await desactivar(ctx, proveedorId);
  revalidar();
  return null;
});

export const asignarProductoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PROVEEDORES, "editar");
  if (!veCostosCompras(ctx)) throw new ForbiddenError(SIN_PRECIOS);
  const { proveedorId, ...datos } = asignarProductoSchema.parse(input);
  await asignarProducto(ctx, proveedorId, datos);
  revalidar();
  return null;
});

/**
 * «Nuevo producto» desde la ficha del proveedor (mientras se actualizan sus
 * precios): crea el producto con sus sabores y, en la MISMA transacción, le
 * carga el precio de este proveedor. Exige PROVEEDORES editar + ver costos y
 * PRODUCTOS crear.
 */
export const crearProductoDeProveedorAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PROVEEDORES, "editar");
  if (!veCostosCompras(ctx)) throw new ForbiddenError(SIN_PRECIOS);
  if (!puede(ctx.usuario, ctx.panelId, Modulo.PRODUCTOS, "crear"))
    throw new ForbiddenError("No tenés permiso para crear productos.");
  const { proveedorId, precio, moneda, producto } = crearProductoDeProveedorSchema.parse(input);
  const r = await transaccion(ctx, async (tx) => {
    const p = await crearProducto(ctx, producto, tx);
    await asignarProducto(ctx, proveedorId, { productoId: p.id, precio, moneda }, tx);
    return p;
  });
  revalidar();
  revalidatePath("/p/[slug]/productos", "layout");
  revalidatePath("/p/[slug]/stock", "layout");
  return { id: r.id };
});

export const quitarProductoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PROVEEDORES, "editar");
  const { proveedorId, productoId } = quitarProductoSchema.parse(input);
  await quitarProducto(ctx, proveedorId, productoId);
  revalidar();
  return null;
});

/** Buscador de productos del panel para "Productos que vende". */
export const buscarProductosProveedorAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PROVEEDORES, "ver");
  const { q } = z.object({ q: z.string().trim().max(100) }).parse(input);
  return buscarProductosDelPanel(ctx, q);
});
