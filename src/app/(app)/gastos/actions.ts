"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { id } from "@/lib/validations/common";
import { actualizarGastoSchema, gastoSchema } from "@/lib/validations/finanzas";
import { actionHandler } from "@/server/action-handler";
import { actorDe } from "@/server/auth/actor";
import { requirePermiso } from "@/server/auth/permissions";
import { ValidationError } from "@/server/errors";
import {
  actualizarGasto,
  eliminarGasto,
  FOTO_MAX_BYTES,
  type FotoComprobante,
} from "@/server/services/gasto.service";
import { crearGasto } from "@/server/services/gasto.service";

/** GASTOS: crear → alta · editar → modificar · eliminar → baja (lógica). */

async function fotoDe(form: FormData): Promise<FotoComprobante | null> {
  const archivo = form.get("comprobante");
  if (!(archivo instanceof File) || archivo.size === 0) return null;
  if (archivo.size > FOTO_MAX_BYTES)
    throw new ValidationError("La foto supera los 5 MB", { comprobante: ["Máximo 5 MB"] });
  return { datos: new Uint8Array(await archivo.arrayBuffer()), tipo: archivo.type };
}

const campos = (form: FormData) => ({
  ...Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")),
  recurrente: form.get("recurrente") === "on" || form.get("recurrente") === "true",
});

export const crearGastoAction = actionHandler(async (form: FormData) => {
  const usuario = await requirePermiso(Modulo.GASTOS, "crear");
  const datos = gastoSchema.parse(campos(form));
  const r = await crearGasto(datos, await fotoDe(form), await actorDe(usuario));
  revalidatePath("/gastos");
  revalidatePath("/caja", "layout");
  return r;
});

export const actualizarGastoAction = actionHandler(async (form: FormData) => {
  const usuario = await requirePermiso(Modulo.GASTOS, "editar");
  const datos = actualizarGastoSchema.parse(campos(form));
  const r = await actualizarGasto(datos.id, datos, await fotoDe(form), await actorDe(usuario));
  revalidatePath("/gastos");
  return r;
});

export const eliminarGastoAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.GASTOS, "eliminar");
  const { id: gastoId } = z.object({ id }).parse(input);
  await eliminarGasto(gastoId, await actorDe(usuario));
  revalidatePath("/gastos");
  revalidatePath("/caja", "layout");
});
