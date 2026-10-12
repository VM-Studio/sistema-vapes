"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { MONEDAS_CAMBIO } from "@/lib/cambio";
import { actionHandler } from "@/server/action-handler";
import { actorDe } from "@/server/auth/actor";
import { requireOwner } from "@/server/auth/permissions";
import {
  actualizarAhora,
  guardarFrecuencia,
  guardarOverride,
  quitarOverride,
} from "@/server/services/cambio.service";

const moneda = z.enum(MONEDAS_CAMBIO);

/** Cotizaciones de moneda (solo dueños). Las fuentes externas se consultan en el servidor. */
export const actualizarCotizacionesAction = actionHandler(async () => {
  const usuario = await requireOwner();
  const r = await actualizarAhora(await actorDe(usuario));
  revalidatePath("/", "layout");
  return r.map((x) => ({ moneda: x.moneda, ok: x.ok, fuente: x.fuente ?? null }));
});

export const guardarOverrideAction = actionHandler(async (input: unknown) => {
  const usuario = await requireOwner();
  const datos = z
    .object({
      moneda,
      valor: z.coerce
        .number({ message: "Ingresá un número" })
        .positive("Tiene que ser mayor a 0")
        .max(1e9, "Demasiado grande"),
    })
    .parse(input);
  await guardarOverride(datos.moneda, datos.valor, await actorDe(usuario));
  revalidatePath("/", "layout");
});

export const quitarOverrideAction = actionHandler(async (input: unknown) => {
  const usuario = await requireOwner();
  await quitarOverride(moneda.parse(input), await actorDe(usuario));
  revalidatePath("/", "layout");
});

export const guardarFrecuenciaAction = actionHandler(async (input: unknown) => {
  const usuario = await requireOwner();
  const minutos = z.coerce.number().int("Minutos enteros").parse(input);
  await guardarFrecuencia(minutos, await actorDe(usuario));
  revalidatePath("/configuracion/cambio");
});
