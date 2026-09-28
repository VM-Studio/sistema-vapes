"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { id } from "@/lib/validations/common";
import {
  ajusteMasivoSchema,
  ajusteSchema,
  ingresoManualSchema,
} from "@/lib/validations/movimiento";
import {
  anularTransferenciaSchema,
  completarTransferenciaSchema,
  crearTransferenciaSchema,
} from "@/lib/validations/transferencia";
import { actionHandler } from "@/server/action-handler";
import { requireCtx, requireCtxAlguno } from "@/server/auth/permissions";
import {
  anularTransferencia,
  completarTransferencia,
  crearTransferencia,
  listarStockParaRecuento,
  registrarAjuste,
  registrarAjusteMasivo,
  registrarIngresoManual,
} from "@/server/services/movimiento.service";
import { buscarVariantes, obtenerVariantesPorId } from "@/server/services/producto.service";

/**
 * Permisos del módulo STOCK (en el panel actual):
 *   ver      → stock, historial y transferencias
 *   crear    → ingreso manual, nueva transferencia
 *   editar   → ajustes / recuento, completar transferencia
 *   eliminar → anular transferencia
 */

function revalidarStock() {
  revalidatePath("/p/[slug]/stock", "layout");
  revalidatePath("/p/[slug]/productos", "layout");
}

function revalidarTransferencias() {
  revalidatePath("/p/[slug]/stock/movimientos/transferencias", "layout");
}

export const ingresoManualAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.STOCK, "crear");
  const r = await registrarIngresoManual(ctx, ingresoManualSchema.parse(input));
  revalidarStock();
  return r;
});

export const ajusteAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.STOCK, "editar");
  const r = await registrarAjuste(ctx, ajusteSchema.parse(input));
  revalidarStock();
  return r;
});

export const ajusteMasivoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.STOCK, "editar");
  const r = await registrarAjusteMasivo(ctx, ajusteMasivoSchema.parse(input));
  revalidarStock();
  return r;
});

export const stockParaRecuentoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.STOCK, "editar");
  const { depositoId, incluirSinStock } = z
    .object({ depositoId: id, incluirSinStock: z.boolean() })
    .parse(input);
  return listarStockParaRecuento(ctx, depositoId, incluirSinStock);
});

export const crearTransferenciaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.STOCK, "crear");
  const r = await crearTransferencia(ctx, crearTransferenciaSchema.parse(input));
  revalidarTransferencias();
  return r;
});

export const completarTransferenciaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.STOCK, "editar");
  const { id: transferenciaId } = completarTransferenciaSchema.parse(input);
  const r = await completarTransferencia(ctx, transferenciaId);
  revalidarStock();
  return r;
});

export const anularTransferenciaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.STOCK, "eliminar");
  const { id: transferenciaId, motivo } = anularTransferenciaSchema.parse(input);
  const r = await anularTransferencia(ctx, transferenciaId, motivo);
  revalidarTransferencias();
  return r;
});

const busquedaSchema = z.object({
  q: z.string().trim().max(100),
  depositoId: id.optional(),
  soloConStockEnDeposito: z.boolean().optional(),
});

/** Buscador de variantes del panel (nombre / variante / SKU / código). Lo usan varias pantallas. */
export const buscarVariantesAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxAlguno([Modulo.STOCK, Modulo.PRODUCTOS, Modulo.COMPRAS], "ver");
  const { q, depositoId, soloConStockEnDeposito } = busquedaSchema.parse(input);
  return buscarVariantes(ctx, q, { depositoId, soloConStockEnDeposito, limite: 15 });
});

/** Stock de variantes ya elegidas en otro depósito (al cambiar el depósito del formulario). */
export const variantesPorIdAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxAlguno([Modulo.STOCK, Modulo.COMPRAS], "ver");
  const { ids, depositoId } = z
    .object({ ids: z.array(id).max(500), depositoId: id.optional() })
    .parse(input);
  return obtenerVariantesPorId(ctx, ids, depositoId);
});
