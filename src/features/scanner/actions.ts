"use server";

import { Modulo } from "@prisma/client";
import { z } from "zod";

import { normalizarCodigoBarras } from "@/lib/barcode";
import { id } from "@/lib/validations/common";
import { actionHandler } from "@/server/action-handler";
import { requireCtxAlguno } from "@/server/auth/permissions";
import { medir } from "@/server/log";
import { buscarPorCodigo, obtenerVarianteEncontrada } from "@/server/services/producto.service";

import type { ResultadoResolucion, VarianteEscaneada } from "./tipos";

/** Módulos desde los que se escanea (cualquiera con "ver" en el panel alcanza para resolver un código). */
const MODULOS_ESCANEO = [Modulo.STOCK, Modulo.COMPRAS, Modulo.PRODUCTOS, Modulo.VENTAS];

/**
 * resolverCodigo(codigo): lo usa todo escaneo (pistola, cámara o manual).
 * Busca SOLO en el panel actual; el costo llega únicamente a los dueños.
 */
export const resolverCodigoAction = actionHandler(
  async (input: unknown): Promise<ResultadoResolucion> => {
    const ctx = await requireCtxAlguno(MODULOS_ESCANEO, "ver");
    const { codigo } = z.object({ codigo: z.string().trim().min(1).max(80) }).parse(input);
    const v = await medir("resolverCodigo", () => buscarPorCodigo(ctx, codigo));
    return v
      ? { encontrado: true, variante: v }
      : { encontrado: false, codigo: normalizarCodigoBarras(codigo) };
  },
);

/** Igual pero por id (al volver de "crear producto" con el código escaneado). */
export const resolverVarianteAction = actionHandler(
  async (input: unknown): Promise<VarianteEscaneada | null> => {
    const ctx = await requireCtxAlguno(MODULOS_ESCANEO, "ver");
    const { varianteId } = z.object({ varianteId: id }).parse(input);
    return obtenerVarianteEncontrada(ctx, varianteId);
  },
);
