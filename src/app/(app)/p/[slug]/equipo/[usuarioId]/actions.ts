"use server";

import { revalidatePath } from "next/cache";

import {
  generarLiquidacionSchema,
  guardarTarifasSchema,
  pagoLiquidacionSchema,
} from "@/lib/validations/ganancia-vendedor";
import { actionHandler } from "@/server/action-handler";
import { requireCtxOwner } from "@/server/auth/permissions";
import {
  generarLiquidacion,
  guardarTarifas,
  quitarTarifas,
  registrarPagoLiquidacion,
} from "@/server/services/ganancia-vendedor.service";
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

export const registrarPagoLiquidacionAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const { id: liquidacionId, ...pago } = pagoLiquidacionSchema.parse(input);
  const r = await registrarPagoLiquidacion(ctx, liquidacionId, pago);
  revalidar();
  return r;
});
