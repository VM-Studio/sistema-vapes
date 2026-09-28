"use server";

import { revalidatePath } from "next/cache";

import { configEscanerSchema } from "@/features/scanner/config";
import {
  actualizarCategoriaSchema,
  actualizarMarcaSchema,
  crearCategoriaSchema,
  crearMarcaSchema,
} from "@/lib/validations/clasificacion";
import { configCatalogoSchema } from "@/lib/validations/config-panel";
import {
  actualizarDepositoSchema,
  cambiarActivoSchema,
  crearDepositoSchema,
} from "@/lib/validations/deposito";
import { configVentasSchema } from "@/lib/validations/venta";
import { actionHandler } from "@/server/action-handler";
import { requireCtxOwner } from "@/server/auth/permissions";
import {
  actualizarCategoria,
  cambiarActivoCategoria,
  crearCategoria,
} from "@/server/services/categoria.service";
import {
  guardarConfigCatalogo,
  guardarConfigEscaner,
  guardarConfigVentas,
} from "@/server/services/configuracion.service";
import {
  actualizarDeposito,
  cambiarActivoDeposito,
  crearDeposito,
} from "@/server/services/deposito.service";
import { actualizarMarca, cambiarActivoMarca, crearMarca } from "@/server/services/marca.service";

/** AJUSTES DEL PANEL: solo dueños, siempre sobre el panel actual. */

function revalidar() {
  // Categorías, marcas y depósitos aparecen en filtros, selects y columnas de todo el panel.
  revalidatePath("/p/[slug]", "layout");
}

// --- Depósitos ---
export const crearDepositoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const r = await crearDeposito(ctx, crearDepositoSchema.parse(input));
  revalidar();
  return r;
});
export const actualizarDepositoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const r = await actualizarDeposito(ctx, actualizarDepositoSchema.parse(input));
  revalidar();
  return r;
});
export const activoDepositoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const { id, activo } = cambiarActivoSchema.parse(input);
  await cambiarActivoDeposito(ctx, id, activo);
  revalidar();
  return null;
});

// --- Categorías ---
export const crearCategoriaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const r = await crearCategoria(ctx, crearCategoriaSchema.parse(input));
  revalidar();
  return r;
});
export const actualizarCategoriaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const r = await actualizarCategoria(ctx, actualizarCategoriaSchema.parse(input));
  revalidar();
  return r;
});
export const activoCategoriaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const { id, activo } = cambiarActivoSchema.parse(input);
  await cambiarActivoCategoria(ctx, id, activo);
  revalidar();
  return null;
});

// --- Marcas ---
export const crearMarcaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const r = await crearMarca(ctx, crearMarcaSchema.parse(input));
  revalidar();
  return r;
});
export const actualizarMarcaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const r = await actualizarMarca(ctx, actualizarMarcaSchema.parse(input));
  revalidar();
  return r;
});
export const activoMarcaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const { id, activo } = cambiarActivoSchema.parse(input);
  await cambiarActivoMarca(ctx, id, activo);
  revalidar();
  return null;
});

// --- Escáner (el layout del panel lo lee: todas las pantallas toman los nuevos valores) ---
export const guardarConfigEscanerAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const r = await guardarConfigEscaner(ctx, configEscanerSchema.parse(input));
  revalidar();
  return r;
});

// --- Ventas y catálogo ---
export const guardarConfigVentasAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const r = await guardarConfigVentas(ctx, configVentasSchema.parse(input));
  revalidar();
  return r;
});
export const guardarConfigCatalogoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const r = await guardarConfigCatalogo(ctx, configCatalogoSchema.parse(input));
  revalidar();
  return r;
});
