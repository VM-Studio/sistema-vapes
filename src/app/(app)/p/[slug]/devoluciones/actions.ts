"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { id } from "@/lib/validations/common";
import { anularDevolucionSchema, registrarDevolucionSchema } from "@/lib/validations/devolucion";
import { actionHandler } from "@/server/action-handler";
import { requireCtx, requireCtxOwner } from "@/server/auth/permissions";
import {
  anularDevolucion,
  otrosSaboresConStock,
  registrarDevolucion,
  ventasParaDevolverDeCliente,
} from "@/server/services/devolucion.service";
import { obtenerVariantesPorId } from "@/server/services/producto.service";

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
  // La diferencia de precio cuenta en "Cobrado" y "Medios de pago" del inicio.
  revalidatePath("/p/[slug]", "page");
  return r;
});

/** Solo dueños: repone la unidad entregada (GARANTIA_ANULADA) y saca la diferencia de lo cobrado. */
export const anularDevolucionAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const { id: devolucionId, motivo } = anularDevolucionSchema.parse(input);
  await anularDevolucion(ctx, devolucionId, motivo);
  revalidar();
  revalidatePath("/p/[slug]", "page");
});

/** "Vincular a una venta": últimas ventas confirmadas del cliente, con lo ya devuelto. */
export const ventasDeClienteAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.DEVOLUCIONES, "crear");
  const { clienteId } = z.object({ clienteId: id }).parse(input);
  return ventasParaDevolverDeCliente(ctx, clienteId, 10);
});

/** Cambiar un sabor sin stock: otros sabores del mismo modelo con stock en el galpón. */
export const otrosSaboresAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.DEVOLUCIONES, "crear");
  const { varianteId, depositoId } = z.object({ varianteId: id, depositoId: id }).parse(input);
  return otrosSaboresConStock(ctx, varianteId, depositoId);
});

/** Sabores por id (precargar los de una venta), con el stock por galpón. */
export const variantesParaDevolucionAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.DEVOLUCIONES, "crear");
  const { ids } = z.object({ ids: z.array(id).max(100) }).parse(input);
  return obtenerVariantesPorId(ctx, ids);
});
