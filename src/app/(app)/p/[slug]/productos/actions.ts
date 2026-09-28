"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { puede } from "@/lib/permisos";
import { id } from "@/lib/validations/common";
import {
  actualizarPreciosSchema,
  actualizarProductoSchema,
  codigoAlternativoSchema,
  productoSchema,
  verificarCodigoSchema,
} from "@/lib/validations/producto";
import { actionHandler } from "@/server/action-handler";
import { requireCtx, requireCtxAlguno } from "@/server/auth/permissions";
import { ForbiddenError, ValidationError } from "@/server/errors";
import {
  actualizarPrecios,
  actualizarProducto,
  agregarCodigoAlternativo,
  asignarCodigosInternos,
  crearProducto,
  darDeBajaProducto,
  generarCodigoInterno,
  quitarCodigoAlternativo,
  verificarCodigoDisponible,
  veCosto,
} from "@/server/services/producto.service";

/**
 * Permisos del módulo PRODUCTOS (en el panel actual):
 *   ver → listado, ficha · crear → nuevo
 *   editar → editar, precios, códigos alternativos · eliminar → dar de baja
 * El precio de costo solo lo ve y lo cambia un dueño.
 */

function revalidar() {
  revalidatePath("/p/[slug]/productos", "layout");
  revalidatePath("/p/[slug]/stock", "layout");
}

export const crearProductoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PRODUCTOS, "crear");
  const r = await crearProducto(ctx, productoSchema.parse(input));
  revalidar();
  return r;
});

export const actualizarProductoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PRODUCTOS, "editar");
  const { id: productoId, datos } = actualizarProductoSchema.parse(input);
  const r = await actualizarProducto(ctx, productoId, datos);
  revalidar();
  return r;
});

export const darDeBajaProductoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PRODUCTOS, "eliminar");
  const { id: productoId } = z.object({ id }).parse(input);
  await darDeBajaProducto(ctx, productoId);
  revalidar();
  return null;
});

/** Validación en vivo del código de barras en el formulario (con debounce). Único por panel. */
export const verificarCodigoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PRODUCTOS, "ver");
  const { codigo, excluirVarianteId } = verificarCodigoSchema.parse(input);
  return verificarCodigoDisponible(ctx, codigo, excluirVarianteId);
});

export const actualizarPreciosAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PRODUCTOS, "editar");
  const { varianteIds, precioCosto, precioVenta, motivo } = actualizarPreciosSchema.parse(input);
  if (precioCosto !== undefined && !veCosto(ctx))
    throw new ForbiddenError("Solo los dueños pueden cambiar el precio de costo.");
  const r = await actualizarPrecios(ctx, varianteIds, { precioCosto, precioVenta }, motivo);
  revalidar();
  return r;
});

export const agregarCodigoAlternativoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PRODUCTOS, "editar");
  const { varianteId, codigo, descripcion } = codigoAlternativoSchema.parse(input);
  const r = await agregarCodigoAlternativo(ctx, varianteId, codigo, descripcion);
  revalidar();
  return r;
});

export const quitarCodigoAlternativoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PRODUCTOS, "editar");
  const { id: altId } = z.object({ id }).parse(input);
  await quitarCodigoAlternativo(ctx, altId);
  revalidar();
  return null;
});

/** Código interno libre en el panel ({prefijo}{7 dígitos}{verificador}) para el formulario (no lo reserva). */
export const generarCodigoInternoAction = actionHandler(async () => {
  // Crear un producto nuevo o editar uno existente: alcanza cualquiera de los dos.
  const ctx = await requireCtxAlguno([Modulo.PRODUCTOS], "ver");
  if (
    !puede(ctx.usuario, ctx.panelId, Modulo.PRODUCTOS, "crear") &&
    !puede(ctx.usuario, ctx.panelId, Modulo.PRODUCTOS, "editar")
  ) {
    throw new ForbiddenError("No tenés permiso para crear ni editar productos.");
  }
  return { codigo: await generarCodigoInterno(ctx) };
});

/** Asigna un código interno a una variante existente que no tiene código (para etiquetarla). */
export const asignarCodigoInternoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PRODUCTOS, "editar");
  const { varianteId } = z.object({ varianteId: id }).parse(input);
  const r = await asignarCodigosInternos(ctx, [varianteId]);
  const asignado = r.asignados[0];
  if (!asignado)
    throw new ValidationError("La variante ya tiene código de barras", {
      varianteId: ["Ya tiene código"],
    });
  revalidar();
  return asignado;
});
