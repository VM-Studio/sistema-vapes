"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { formatearIdCompra } from "@/lib/paneles";
import { id } from "@/lib/validations/common";
import {
  anularCompraSchema,
  costoSugeridoSchema,
  guardarCompraSchema,
  recibirCompraSchema,
} from "@/lib/validations/compra";
import { actionHandler } from "@/server/action-handler";
import { requireCtx } from "@/server/auth/permissions";
import {
  actualizarCompra,
  anularCompra,
  costoSugerido,
  crearCompra,
  preciosQueCambian,
  recibirCompra,
} from "@/server/services/compra.service";
import { buscarVariantes } from "@/server/services/producto.service";

/**
 * Permisos de COMPRAS: crear → nueva (borrador) · editar → modificar el
 * borrador y recibir la mercadería (mueve stock y, si se elige, actualiza el
 * precio del proveedor) · eliminar → anular.
 */

function revalidar() {
  revalidatePath("/p/[slug]/compras", "layout");
  revalidatePath("/p/[slug]/stock", "layout");
  revalidatePath("/p/[slug]/proveedores", "layout");
  revalidatePath("/p/[slug]/productos", "layout");
}

/** Crea o actualiza el borrador. */
export const guardarCompraAction = actionHandler(async (input: unknown) => {
  const { id: compraId, datos } = guardarCompraSchema.parse(input);
  const ctx = await requireCtx(Modulo.COMPRAS, compraId ? "editar" : "crear");
  const r = compraId ? await actualizarCompra(ctx, compraId, datos) : await crearCompra(ctx, datos);
  revalidar();
  return { ...r, idVisible: formatearIdCompra(ctx.panel.slug, r.numero) };
});

export const preciosQueCambianAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.COMPRAS, "editar");
  const { id: compraId } = z.object({ id }).parse(input);
  return preciosQueCambian(ctx, compraId);
});

export const recibirCompraAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.COMPRAS, "editar");
  const { id: compraId, actualizarPrecioProveedor } = recibirCompraSchema.parse(input);
  const r = await recibirCompra(ctx, compraId, { actualizarPrecioProveedor });
  revalidar();
  return { ...r, idVisible: formatearIdCompra(ctx.panel.slug, r.numero) };
});

export const anularCompraAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.COMPRAS, "eliminar");
  const { id: compraId, motivo } = anularCompraSchema.parse(input);
  const r = await anularCompra(ctx, compraId, motivo);
  revalidar();
  return { ...r, idVisible: formatearIdCompra(ctx.panel.slug, r.numero) };
});

export const costoSugeridoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.COMPRAS, "ver");
  const { proveedorId, varianteIds } = costoSugeridoSchema.parse(input);
  return costoSugerido(ctx, proveedorId, varianteIds);
});

export interface SaborBuscado {
  varianteId: string;
  productoId: string;
  nombreCompleto: string;
  sabor: string | null;
  sku: string;
  codigoBarras: string | null;
}

/** Buscador manual de la compra (por nombre completo, sabor, SKU o código). */
export const buscarSaboresCompraAction = actionHandler(
  async (input: unknown): Promise<SaborBuscado[]> => {
    const ctx = await requireCtx(Modulo.COMPRAS, "ver");
    const { q } = z.object({ q: z.string().trim().max(100) }).parse(input);
    if (!q) return [];
    const variantes = await buscarVariantes(ctx, q);
    return variantes.map((v) => ({
      varianteId: v.varianteId,
      productoId: v.productoId,
      nombreCompleto: v.nombreCompleto,
      sabor: v.sabor,
      sku: v.sku,
      codigoBarras: v.codigoBarras,
    }));
  },
);
