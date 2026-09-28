"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { id } from "@/lib/validations/common";
import { anularDevolucionSchema, registrarDevolucionSchema } from "@/lib/validations/devolucion";
import { actionHandler } from "@/server/action-handler";
import { requireCtx, requireCtxOwner } from "@/server/auth/permissions";
import { anularDevolucion, registrarDevolucion } from "@/server/services/devolucion.service";
import { obtenerVariantesPorId } from "@/server/services/producto.service";
import { ventasDeCliente } from "@/server/services/venta.service";

function revalidar() {
  revalidatePath("/p/[slug]/devoluciones", "layout");
  revalidatePath("/p/[slug]/clientes", "layout");
  revalidatePath("/p/[slug]/stock", "layout");
  revalidatePath("/p/[slug]/productos", "layout");
}

export const registrarDevolucionAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.DEVOLUCIONES, "crear");
  const r = await registrarDevolucion(ctx, registrarDevolucionSchema.parse(input));
  revalidar();
  return r;
});

/** Solo dueños: repone el stock (GARANTIA_ANULADA). */
export const anularDevolucionAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const { id: devolucionId, motivo } = anularDevolucionSchema.parse(input);
  await anularDevolucion(ctx, devolucionId, motivo);
  revalidar();
});

/** "Vincular a una venta": últimas ventas confirmadas del cliente. */
export const ventasDeClienteAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.DEVOLUCIONES, "crear");
  const { clienteId } = z.object({ clienteId: id }).parse(input);
  return ventasDeCliente(ctx, clienteId, 10);
});

/** Sabores por id (precargar los de una venta), con el stock por galpón. */
export const variantesParaDevolucionAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.DEVOLUCIONES, "crear");
  const { ids } = z.object({ ids: z.array(id).max(100) }).parse(input);
  return obtenerVariantesPorId(ctx, ids);
});
