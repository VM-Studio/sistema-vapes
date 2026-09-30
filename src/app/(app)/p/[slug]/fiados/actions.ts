"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { anularCobroSchema, registrarCobroSchema } from "@/lib/validations/fiado";
import { actionHandler } from "@/server/action-handler";
import { requireCtx, requireCtxOwner } from "@/server/auth/permissions";
import { anularCobro, registrarCobro } from "@/server/services/fiado.service";

/**
 * FIADOS (en el panel actual): ver → deudores y cuenta corriente ·
 * editar → registrar cobros · anular un cobro → solo dueños.
 * Saldos e imputación los calcula el servicio.
 */

/** Un cobro cambia la deuda del cliente, sus ventas y el dashboard. */
function revalidar() {
  revalidatePath("/p/[slug]/fiados", "layout");
  revalidatePath("/p/[slug]/clientes", "layout");
  revalidatePath("/p/[slug]/ventas", "layout");
  revalidatePath("/p/[slug]", "page");
}

export const registrarCobroAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.FIADOS, "editar");
  const r = await registrarCobro(ctx, registrarCobroSchema.parse(input));
  revalidar();
  return r;
});

export const anularCobroAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const { pagoId, motivo } = anularCobroSchema.parse(input);
  const r = await anularCobro(ctx, pagoId, motivo);
  revalidar();
  return r;
});
