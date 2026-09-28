"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { VarianteEncontrada } from "@/features/scanner/tipos";
import { puede } from "@/lib/permisos";
import { id } from "@/lib/validations/common";
import {
  actualizarProductoSchema,
  altaRapidaSchema,
  cargarStockSchema,
  codigoAlternativoSchema,
  productoSchema,
  verificarCodigoSchema,
} from "@/lib/validations/producto";
import { actionHandler } from "@/server/action-handler";
import { requireCtx, requireCtxAlguno } from "@/server/auth/permissions";
import { ForbiddenError, ValidationError } from "@/server/errors";
import {
  actualizar,
  agregarCodigoAlternativo,
  altaRapida,
  asignarCodigosInternos,
  buscarParaAltaRapida,
  cargarStockPorEscaneo,
  crear,
  desactivar,
  generarCodigoInterno,
  productoPorClave,
  quitarCodigoAlternativo,
  verificarCodigoDisponible,
} from "@/server/services/producto.service";

/**
 * Permisos del módulo PRODUCTOS (en el panel actual):
 *   ver → listado, ficha · crear → nuevo, alta rápida · editar → editar, códigos, desactivar
 * Cargar stock por escaneo: PRODUCTOS crear o STOCK crear.
 * Alta rápida (código desconocido): PRODUCTOS crear o COMPRAS crear.
 */

function revalidar() {
  revalidatePath("/p/[slug]/productos", "layout");
  revalidatePath("/p/[slug]/stock", "layout");
}

export const crearProductoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PRODUCTOS, "crear");
  const r = await crear(ctx, productoSchema.parse(input));
  revalidar();
  return r;
});

export const actualizarProductoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PRODUCTOS, "editar");
  const { id: productoId, datos } = actualizarProductoSchema.parse(input);
  const r = await actualizar(ctx, productoId, datos);
  revalidar();
  return r;
});

export const desactivarProductoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PRODUCTOS, "editar");
  const { id: productoId } = z.object({ id }).parse(input);
  await desactivar(ctx, productoId);
  revalidar();
  return null;
});

/** Validación en vivo del código de barras en el formulario (con debounce). Único por panel. */
export const verificarCodigoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxAlguno([Modulo.PRODUCTOS, Modulo.COMPRAS], "crear");
  const { codigo, excluirVarianteId } = verificarCodigoSchema.parse(input);
  return verificarCodigoDisponible(ctx, codigo, excluirVarianteId);
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
  const ctx = await requireCtx(Modulo.PRODUCTOS, "ver");
  if (
    !puede(ctx.usuario, ctx.panelId, Modulo.PRODUCTOS, "crear") &&
    !puede(ctx.usuario, ctx.panelId, Modulo.PRODUCTOS, "editar")
  )
    throw new ForbiddenError("No tenés permiso para crear ni editar productos.");
  return { codigo: await generarCodigoInterno(ctx) };
});

/** Asigna un código interno a un sabor existente que no tiene código (para etiquetarlo). */
export const asignarCodigoInternoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PRODUCTOS, "editar");
  const { varianteId } = z.object({ varianteId: id }).parse(input);
  const r = await asignarCodigosInternos(ctx, [varianteId]);
  const asignado = r.asignados[0];
  if (!asignado)
    throw new ValidationError("El sabor ya tiene código de barras", {
      varianteId: ["Ya tiene código"],
    });
  revalidar();
  return asignado;
});

// --- Escáner: alta rápida y carga de stock -----------------------------------

/** Código desconocido → producto/sabor nuevo, listo para la lista de carga. */
export const altaRapidaAction = actionHandler(
  async (input: unknown): Promise<VarianteEncontrada> => {
    const ctx = await requireCtxAlguno([Modulo.PRODUCTOS, Modulo.COMPRAS], "crear");
    const v = await altaRapida(ctx, altaRapidaSchema.parse(input));
    revalidar();
    return v;
  },
);

/** Autocompletar del alta rápida: marcas y productos que coinciden con el texto. */
export const buscarProductosAltaAction = actionHandler(async (q: unknown) => {
  const ctx = await requireCtxAlguno([Modulo.PRODUCTOS, Modulo.COMPRAS], "crear");
  return buscarParaAltaRapida(ctx, z.string().max(100).catch("").parse(q));
});

/** ¿Marca + modelo + especificación ya existe? (el Sheet pide solo sabor y precio si difiere). */
export const productoPorClaveAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxAlguno([Modulo.PRODUCTOS, Modulo.COMPRAS], "crear");
  const clave = z
    .object({
      marca: z.string().trim().min(1).max(80),
      modelo: z.string().trim().min(1).max(120),
      especificacion: z.string().trim().max(60).default(""),
    })
    .parse(input);
  return productoPorClave(ctx, clave);
});

/** Confirma la lista de carga: un INGRESO_MANUAL por sabor en el galpón elegido (una transacción). */
export const cargarStockPorEscaneoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxAlguno([Modulo.PRODUCTOS, Modulo.STOCK], "crear");
  const r = await cargarStockPorEscaneo(ctx, cargarStockSchema.parse(input));
  revalidar();
  return r;
});
