"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { esOwner, puede } from "@/lib/permisos";
import {
  anularCompraSchema,
  guardarCompraSchema,
  recibirCompraSchema,
} from "@/lib/validations/compra";
import { actionHandler } from "@/server/action-handler";
import { requireCtx } from "@/server/auth/permissions";
import { AppError, ForbiddenError } from "@/server/errors";
import { log } from "@/server/log";
import {
  actualizarCompra,
  anularCompra,
  crearCompra,
  recibirCompra,
} from "@/server/services/compra.service";

/**
 * Permisos de COMPRAS: crear → nueva (borrador) · editar → modificar el borrador
 * y recibir la mercadería (mueve stock) · eliminar → anular. Actualizar el
 * precio de costo de las variantes al recibir: solo dueños.
 */

function revalidar() {
  revalidatePath("/p/[slug]/compras", "layout");
  revalidatePath("/p/[slug]/stock", "layout");
  revalidatePath("/p/[slug]/proveedores", "layout");
}

/** Crea o actualiza el borrador y, si se pide, lo recibe en el mismo paso. */
export const guardarCompraAction = actionHandler(async (input: unknown) => {
  const { id, datos, recibir, actualizarCostos } = guardarCompraSchema.parse(input);
  const ctx = await requireCtx(Modulo.COMPRAS, id ? "editar" : "crear");
  if (recibir && !puede(ctx.usuario, ctx.panelId, Modulo.COMPRAS, "editar")) {
    throw new ForbiddenError("No tenés permiso para recibir compras.");
  }
  const guardada = id ? await actualizarCompra(ctx, id, datos) : await crearCompra(ctx, datos);
  let recibida: Awaited<ReturnType<typeof recibirCompra>> | null = null;
  let errorAlRecibir: string | null = null;
  if (recibir) {
    try {
      recibida = await recibirCompra(ctx, guardada.id, {
        actualizarCostos: actualizarCostos && esOwner(ctx.usuario),
      });
    } catch (e) {
      // El borrador ya quedó guardado: se informa sin perderlo (reintentar no debe duplicarlo).
      if (!(e instanceof AppError)) log.error({ err: e }, "error al recibir la compra");
      errorAlRecibir =
        e instanceof AppError
          ? e.message
          : "Error inesperado al recibir. Reintentá desde el detalle de la compra.";
    }
  }
  revalidar();
  if (recibida?.costosActualizados) revalidatePath("/p/[slug]/productos", "layout");
  return { ...guardada, recibida, errorAlRecibir };
});

export const recibirCompraAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.COMPRAS, "editar");
  const { id, actualizarCostos } = recibirCompraSchema.parse(input);
  const r = await recibirCompra(ctx, id, {
    actualizarCostos: actualizarCostos && esOwner(ctx.usuario),
  });
  revalidar();
  if (r.costosActualizados) revalidatePath("/p/[slug]/productos", "layout");
  return r;
});

export const anularCompraAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.COMPRAS, "eliminar");
  const { id, motivo } = anularCompraSchema.parse(input);
  const r = await anularCompra(ctx, id, motivo);
  revalidar();
  return r;
});
