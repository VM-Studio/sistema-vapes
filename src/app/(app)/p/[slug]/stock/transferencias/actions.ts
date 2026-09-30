"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";

import {
  anularTransferenciaSchema,
  completarTransferenciaSchema,
  crearTransferenciaSchema,
  remitoTransferenciaSchema,
} from "@/lib/validations/transferencia";
import { actionHandler } from "@/server/action-handler";
import { requireCtx } from "@/server/auth/permissions";
import {
  anularTransferencia,
  completarTransferencia,
  crearYCompletarTransferencia,
  generarRemito,
  mensajeWhatsAppTransferencia,
  obtenerTransferencia,
  registrarEnvioTransferencia,
} from "@/server/services/transferencia.service";

/**
 * Permisos del módulo STOCK (en el panel actual):
 *   ver      → listado, detalle y remito
 *   crear    → nueva transferencia ("Mover ahora" o "Registrar envío")
 *   editar   → confirmar la recepción de una pendiente
 *   eliminar → anular una pendiente
 */

function revalidarStock() {
  revalidatePath("/p/[slug]/stock", "layout");
  revalidatePath("/p/[slug]/productos", "layout");
}

/** "Mover ahora": se crea y se completa en el acto (el stock se mueve ya). */
export const moverAhoraAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.STOCK, "crear");
  const r = await crearYCompletarTransferencia(ctx, crearTransferenciaSchema.parse(input));
  revalidarStock();
  return { ...r, whatsapp: await mensajeWhatsAppTransferencia(ctx, r.id) };
});

/** "Registrar envío, confirmar al recibir": queda PENDIENTE, no mueve stock. */
export const registrarEnvioAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.STOCK, "crear");
  const r = await registrarEnvioTransferencia(ctx, crearTransferenciaSchema.parse(input));
  revalidarStock();
  return { ...r, whatsapp: await mensajeWhatsAppTransferencia(ctx, r.id) };
});

/** "Confirmar recepción" de una pendiente: recién ahí se mueve el stock. */
export const completarTransferenciaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.STOCK, "editar");
  const { id } = completarTransferenciaSchema.parse(input);
  const r = await completarTransferencia(ctx, id);
  revalidarStock();
  return r;
});

export const anularTransferenciaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.STOCK, "eliminar");
  const { id, motivo } = anularTransferenciaSchema.parse(input);
  const r = await anularTransferencia(ctx, id, motivo);
  revalidarStock();
  return r;
});

/** Link al remito PDF; si todavía no existe (falló al crear), lo genera. */
export const remitoTransferenciaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.STOCK, "ver");
  const { id } = remitoTransferenciaSchema.parse(input);
  const t = await obtenerTransferencia(ctx, id);
  if (t.remitoUrl) return { url: t.remitoUrl };
  const r = await generarRemito(ctx, id);
  revalidatePath("/p/[slug]/stock/transferencias", "layout");
  return r;
});
