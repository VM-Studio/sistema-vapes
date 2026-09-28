"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { ajusteSchema } from "@/lib/validations/movimiento";
import {
  anularTransferenciaSchema,
  completarTransferenciaSchema,
  transferenciaRapidaSchema,
} from "@/lib/validations/transferencia";
import { actionHandler } from "@/server/action-handler";
import { requireCtx } from "@/server/auth/permissions";
import {
  anularTransferencia,
  completarTransferencia,
  registrarAjuste,
  transferirAhora,
} from "@/server/services/movimiento.service";

/**
 * Permisos del módulo STOCK (en el panel actual):
 *   ver      → stock por galpón / global, movimientos y transferencias
 *   crear    → transferir a otro galpón
 *   editar   → ajustar (conteo real), completar una transferencia pendiente
 *   eliminar → anular una transferencia pendiente
 */

function revalidarStock() {
  revalidatePath("/p/[slug]/stock", "layout");
  revalidatePath("/p/[slug]/productos", "layout");
}

export const ajusteAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.STOCK, "editar");
  const r = await registrarAjuste(ctx, ajusteSchema.parse(input));
  revalidarStock();
  return r;
});

/** "Transferir a {otro galpón}" desde la fila: se crea y se completa en el acto. */
export const transferirAhoraAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.STOCK, "crear");
  const r = await transferirAhora(ctx, transferenciaRapidaSchema.parse(input));
  revalidarStock();
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
  revalidarStock();
  return r;
});
