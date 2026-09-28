"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { id } from "@/lib/validations/common";
import {
  actualizarProveedorSchema,
  asignarProductoSchema,
  crearProveedorSchema,
  quitarProductoSchema,
} from "@/lib/validations/proveedor";
import { actionHandler } from "@/server/action-handler";
import { requireCtx } from "@/server/auth/permissions";
import { ForbiddenError } from "@/server/errors";
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
