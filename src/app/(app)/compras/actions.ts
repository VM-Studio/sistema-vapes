"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";

import {
  anularCompraSchema,
  guardarCompraSchema,
  recibirCompraSchema,
} from "@/lib/validations/compra";
import { actionHandler } from "@/server/action-handler";
import { AppError } from "@/server/errors";
import { actorDe } from "@/server/auth/actor";
import { requirePermiso } from "@/server/auth/permissions";
import {
  actualizarCompra,
  anularCompra,
  crearCompra,
  recibirCompra,
} from "@/server/services/compra.service";

/**
 * Permisos de COMPRAS: crear → nueva (borrador) · editar → modificar el borrador
 * y recibir la mercadería (mueve stock) · eliminar → anular.
 */

function revalidar(id?: string) {
  revalidatePath("/compras");
  if (id) revalidatePath(`/compras/${id}`);
  revalidatePath("/inventario");
  revalidatePath("/movimientos");
  revalidatePath("/proveedores", "layout");
}

/** Crea o actualiza el borrador y, si se pide, lo recibe en el mismo paso. */
export const guardarCompraAction = actionHandler(async (input: unknown) => {
  const { id, datos, recibir, actualizarCostos } = guardarCompraSchema.parse(input);
  const usuario = await requirePermiso(Modulo.COMPRAS, id ? "editar" : "crear");
  if (recibir) await requirePermiso(Modulo.COMPRAS, "editar");
  const actor = await actorDe(usuario);
  const guardada = id ? await actualizarCompra(id, datos, actor) : await crearCompra(datos, actor);
  let recibida: Awaited<ReturnType<typeof recibirCompra>> | null = null;
  let errorAlRecibir: string | null = null;
  if (recibir) {
    try {
      recibida = await recibirCompra(guardada.id, actor, { actualizarCostos });
    } catch (e) {
      // El borrador ya quedó guardado: se informa sin perderlo (reintentar no debe duplicarlo).
      if (!(e instanceof AppError)) console.error("[compras] error al recibir", e);
      errorAlRecibir =
        e instanceof AppError
          ? e.message
          : "Error inesperado al recibir. Reintentá desde el detalle de la compra.";
    }
  }
  revalidar(guardada.id);
  return { ...guardada, recibida, errorAlRecibir };
});

export const recibirCompraAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.COMPRAS, "editar");
  const { id, actualizarCostos } = recibirCompraSchema.parse(input);
  const r = await recibirCompra(id, await actorDe(usuario), { actualizarCostos });
  revalidar(id);
  revalidatePath("/productos", "layout");
  return r;
});

export const anularCompraAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.COMPRAS, "eliminar");
  const { id, motivo } = anularCompraSchema.parse(input);
  const r = await anularCompra(id, motivo, await actorDe(usuario));
  revalidar(id);
  return r;
});
