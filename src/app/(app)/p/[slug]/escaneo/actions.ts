"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { escaneoRemotoSchema } from "@/lib/validations/venta";
import { actionHandler } from "@/server/action-handler";
import { requireCtx } from "@/server/auth/permissions";
import {
  confirmarEscaneo,
  evaluarCodigosEscaneo,
  listarPendientesDeEscaneo,
} from "@/server/services/escaneo-remoto.service";

/**
 * «Escanea Charly» (ESCANEO "ver"): la lista de ventas pedidas, la evaluación
 * de lo escaneado y la confirmación. Toda la validación es del servicio.
 */

/** Refresco periódico de la lista (polling liviano de la pantalla). */
export const pendientesEscaneoAction = actionHandler(async () => {
  const ctx = await requireCtx(Modulo.ESCANEO, "ver");
  return listarPendientesDeEscaneo(ctx);
});

/** Evalúa los códigos escaneados hasta ahora (lista completa, en orden). */
export const evaluarEscaneoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.ESCANEO, "ver");
  const { ventaId, codigos } = escaneoRemotoSchema.parse(input);
  return evaluarCodigosEscaneo(ctx, ventaId, codigos);
});

/** «Vape escaneado»: confirma solo si todo coincide exacto. */
export const confirmarEscaneoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.ESCANEO, "ver");
  const { ventaId, codigos } = escaneoRemotoSchema.parse(input);
  const r = await confirmarEscaneo(ctx, ventaId, codigos);
  revalidatePath("/p/[slug]/ventas", "layout");
  revalidatePath("/p/[slug]", "page");
  return r;
});
