"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { formatearIdCompra } from "@/lib/paneles";
import { id } from "@/lib/validations/common";
import { esOwner } from "@/lib/permisos";
import {
  agregarGastosCompraSchema,
  anularCompraSchema,
  anularGastoCompraSchema,
  catalogoCompraSchema,
  comisionPasistaSchema,
  costoSugeridoSchema,
  guardarBorradorCompraSchema,
  guardarCompraSchema,
  ofertasCompraSchema,
  recibirCompraSchema,
} from "@/lib/validations/compra";
import { actionHandler } from "@/server/action-handler";
import { requireCtx } from "@/server/auth/permissions";
import { ForbiddenError } from "@/server/errors";
import {
  actualizarCompra,
  agregarGastosCompra,
  anularCompra,
  anularGastoCompra,
  cambiarComisionPasista,
  catalogoParaCompra,
  costoSugerido,
  crearCompra,
  obtenerCostosCompra,
  preciosQueCambian,
  recibirCompra,
} from "@/server/services/compra.service";
import {
  descartarBorradorCompra,
  guardarBorradorCompra,
} from "@/server/services/borrador-compra.service";
import { buscarVariantes } from "@/server/services/producto.service";
import { ofertasParaCompra } from "@/server/services/proveedor.service";

/**
 * Permisos de COMPRAS: crear → nueva (borrador) · editar → modificar el
 * borrador y recibir la mercadería (mueve stock y, si se elige, actualiza el
 * precio del proveedor), cambiar la comisión del pasista y cargar gastos
 * extras · eliminar → anular. Anular un gasto extra: solo dueños.
 */

function revalidar() {
  revalidatePath("/p/[slug]/compras", "layout");
  revalidatePath("/p/[slug]/stock", "layout");
  revalidatePath("/p/[slug]/proveedores", "layout");
  revalidatePath("/p/[slug]/productos", "layout");
}

/** Confirma la compra nueva (y borra su borrador) o actualiza una pendiente de recibir. */
export const guardarCompraAction = actionHandler(async (input: unknown) => {
  const { id: compraId, datos, borradorId } = guardarCompraSchema.parse(input);
  const ctx = await requireCtx(Modulo.COMPRAS, compraId ? "editar" : "crear");
  const r = compraId ? await actualizarCompra(ctx, compraId, datos) : await crearCompra(ctx, datos);
  if (!compraId && borradorId) await descartarBorradorCompra(ctx, borradorId);
  revalidar();
  return { ...r, idVisible: formatearIdCompra(ctx.panel.slug, r.numero) };
});

/**
 * Guardado automático de «Nueva compra» (lo tipeado, a medias): crea el
 * borrador o lo pisa. No revalida: el listado lo lee al entrar.
 */
export const guardarBorradorCompraAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.COMPRAS, "crear");
  return guardarBorradorCompra(ctx, guardarBorradorCompraSchema.parse(input));
});

export const descartarBorradorCompraAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.COMPRAS, "crear");
  const { id: borradorId } = z.object({ id }).parse(input);
  await descartarBorradorCompra(ctx, borradorId);
  revalidatePath("/p/[slug]/compras", "page");
  return null;
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
  const { proveedorId, varianteIds, compraId } = costoSugeridoSchema.parse(input);
  return costoSugerido(ctx, proveedorId, varianteIds, compraId);
});

/** Lo que vende el proveedor elegido, con su precio y el costo en pesos que se precarga. */
export const catalogoProveedorCompraAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.COMPRAS, "ver");
  const { proveedorId, compraId, depositoId } = catalogoCompraSchema.parse(input);
  return catalogoParaCompra(ctx, proveedorId, { compraId, depositoId });
});

/** Quién vende cada producto de la compra y a cuánto (del más barato al más caro). */
export const ofertasCompraAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.COMPRAS, "ver");
  const { productoIds, proveedorId } = ofertasCompraSchema.parse(input);
  return ofertasParaCompra(ctx, productoIds, proveedorId ?? null);
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

// --- Costos finales (Bloque 6): comisión del pasista y gastos extras ---

export const obtenerCostosCompraAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.COMPRAS, "ver");
  const { id: compraId } = z.object({ id }).parse(input);
  return obtenerCostosCompra(ctx, compraId);
});

/** Tick (y %) de la comisión del pasista en una compra ya guardada. */
export const cambiarComisionPasistaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.COMPRAS, "editar");
  const { id: compraId, comisionPasistaPorcentaje } = comisionPasistaSchema.parse(input);
  const r = await cambiarComisionPasista(ctx, compraId, comisionPasistaPorcentaje);
  revalidar();
  return { idVisible: r.idVisible };
});

export const agregarGastosCompraAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.COMPRAS, "editar");
  const { compraId, gastos } = agregarGastosCompraSchema.parse(input);
  const r = await agregarGastosCompra(ctx, compraId, gastos);
  revalidar();
  return { idVisible: r.idVisible };
});

/** Anular un gasto: solo dueños. */
export const anularGastoCompraAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.COMPRAS, "editar");
  if (!esOwner(ctx.usuario))
    throw new ForbiddenError("Solo los dueños anulan gastos de una compra");
  const { id: gastoId, motivo } = anularGastoCompraSchema.parse(input);
  const r = await anularGastoCompra(ctx, gastoId, motivo);
  revalidar();
  return { idVisible: r.idVisible };
});
