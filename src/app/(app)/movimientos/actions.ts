"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { id } from "@/lib/validations/common";
import {
  ajusteMasivoSchema,
  ajusteSchema,
  ingresoManualSchema,
} from "@/lib/validations/movimiento";
import {
  anularTransferenciaSchema,
  completarTransferenciaSchema,
  crearTransferenciaSchema,
} from "@/lib/validations/transferencia";
import { actionHandler } from "@/server/action-handler";
import { actorDe } from "@/server/auth/actor";
import { requirePermiso, requirePermisoAlguno } from "@/server/auth/permissions";
import {
  anularTransferencia,
  completarTransferencia,
  crearTransferencia,
  listarStockParaRecuento,
  registrarAjuste,
  registrarAjusteMasivo,
  registrarIngresoManual,
} from "@/server/services/movimiento.service";
import { buscarVariantes, obtenerVariantesPorId } from "@/server/services/producto.service";

/**
 * Permisos del módulo MOVIMIENTOS:
 *   ver      → ledger y transferencias
 *   crear    → ingreso manual, nueva transferencia
 *   editar   → ajustes / recuento, completar transferencia
 *   eliminar → anular transferencia
 */

function revalidarStock() {
  revalidatePath("/inventario");
  revalidatePath("/movimientos");
  revalidatePath("/productos", "layout");
}

export const ingresoManualAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.MOVIMIENTOS, "crear");
  const r = await registrarIngresoManual(ingresoManualSchema.parse(input), await actorDe(usuario));
  revalidarStock();
  return r;
});

export const ajusteAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.MOVIMIENTOS, "editar");
  const r = await registrarAjuste(ajusteSchema.parse(input), await actorDe(usuario));
  revalidarStock();
  return r;
});

export const ajusteMasivoAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.MOVIMIENTOS, "editar");
  const r = await registrarAjusteMasivo(ajusteMasivoSchema.parse(input), await actorDe(usuario));
  revalidarStock();
  return r;
});

export const stockParaRecuentoAction = actionHandler(async (input: unknown) => {
  await requirePermiso(Modulo.MOVIMIENTOS, "editar");
  const { depositoId, incluirSinStock } = z
    .object({ depositoId: id, incluirSinStock: z.boolean() })
    .parse(input);
  return listarStockParaRecuento(depositoId, incluirSinStock);
});

export const crearTransferenciaAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.MOVIMIENTOS, "crear");
  const r = await crearTransferencia(crearTransferenciaSchema.parse(input), await actorDe(usuario));
  revalidatePath("/movimientos/transferencias");
  return r;
});

export const completarTransferenciaAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.MOVIMIENTOS, "editar");
  const { id: transferenciaId } = completarTransferenciaSchema.parse(input);
  const r = await completarTransferencia(transferenciaId, await actorDe(usuario));
  revalidarStock();
  revalidatePath(`/movimientos/transferencias/${transferenciaId}`);
  return r;
});

export const anularTransferenciaAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.MOVIMIENTOS, "eliminar");
  const { id: transferenciaId, motivo } = anularTransferenciaSchema.parse(input);
  const r = await anularTransferencia(transferenciaId, motivo, await actorDe(usuario));
  revalidatePath("/movimientos/transferencias");
  revalidatePath(`/movimientos/transferencias/${transferenciaId}`);
  return r;
});

const busquedaSchema = z.object({
  q: z.string().trim().max(100),
  depositoId: id.optional(),
  soloConStockEnDeposito: z.boolean().optional(),
});

/** Buscador de variantes (nombre / sabor / SKU / código). Lo usan varias pantallas. */
export const buscarVariantesAction = actionHandler(async (input: unknown) => {
  await requirePermisoAlguno(
    [Modulo.MOVIMIENTOS, Modulo.INVENTARIO, Modulo.PRODUCTOS, Modulo.COMPRAS],
    "ver",
  );
  const { q, depositoId, soloConStockEnDeposito } = busquedaSchema.parse(input);
  return buscarVariantes(q, { depositoId, soloConStockEnDeposito, limite: 15 });
});

/** Stock de variantes ya elegidas en otro depósito (al cambiar el depósito del formulario). */
export const variantesPorIdAction = actionHandler(async (input: unknown) => {
  await requirePermisoAlguno([Modulo.MOVIMIENTOS, Modulo.INVENTARIO, Modulo.COMPRAS], "ver");
  const { ids, depositoId } = z
    .object({ ids: z.array(id).max(500), depositoId: id.optional() })
    .parse(input);
  return obtenerVariantesPorId(ids, depositoId);
});
