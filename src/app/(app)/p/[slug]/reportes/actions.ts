"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionHandler } from "@/server/action-handler";
import { requireCtxOwner } from "@/server/auth/permissions";
import { guardarCotizacionUsd } from "@/server/services/configuracion.service";

/** Reportes: cotización del dólar del comparador (solo dueños). */

const cotizacionSchema = z.object({
  cotizacionUsd: z
    .union([z.coerce.number().positive("Tiene que ser mayor a 0").max(1_000_000), z.null()])
    .nullable(),
});

export const guardarCotizacionUsdAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const { cotizacionUsd } = cotizacionSchema.parse(input);
  const r = await guardarCotizacionUsd(ctx, cotizacionUsd);
  revalidatePath("/p/[slug]/reportes", "layout");
  return { cotizacionUsd: r };
});
