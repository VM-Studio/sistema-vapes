"use server";

import { revalidatePath } from "next/cache";

import {
  generarLiquidacionSchema,
  guardarTarifasSchema,
  pagoConFirmaSchema,
} from "@/lib/validations/ganancia-vendedor";
import { actionHandler } from "@/server/action-handler";
import { requireCtxOwner } from "@/server/auth/permissions";
import {
  generarLiquidacion,
  guardarTarifas,
  quitarTarifas,
} from "@/server/services/ganancia-vendedor.service";
import {
  registrarPagoConFirma,
  reenviarRemito,
} from "@/server/services/remito-liquidacion.service";
import { id } from "@/lib/validations/common";

/** Ganancia por vape y liquidaciones: todo solo dueños (lo exige también el servicio). */

function revalidar() {
  revalidatePath("/p/[slug]", "layout");
}

export const guardarTarifasAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const { usuarioId, ...tarifas } = guardarTarifasSchema.parse(input);
  await guardarTarifas(ctx, usuarioId, tarifas);
  revalidar();
  return { ok: true };
});

export const quitarTarifasAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  await quitarTarifas(ctx, id.parse((input as { usuarioId?: unknown })?.usuarioId));
  revalidar();
  return { ok: true };
});

export const generarLiquidacionAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const { usuarioId, mes } = generarLiquidacionSchema.parse(input);
  const r = await generarLiquidacion(ctx, usuarioId, mes);
  revalidar();
  return r;
});

/**
 * Registrar el pago FIRMANDO el remito (dueños): queda pagada con la firma
 * del dueño y se le manda el remito al vendedor con el link para firmar.
 */
export const registrarPagoLiquidacionAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const { id: liquidacionId, firma, ...pago } = pagoConFirmaSchema.parse(input);
  const r = await registrarPagoConFirma(ctx, liquidacionId, pago, firma);
  revalidar();
  return r;
});

/** Reenviar: link nuevo + mail al vendedor (sin firmar) o el remito final a los dueños (firmada). */
export const reenviarRemitoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const r = await reenviarRemito(ctx, id.parse((input as { id?: unknown })?.id));
  revalidar();
  return r;
});
