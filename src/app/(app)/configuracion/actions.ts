"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";

import {
  actualizarCategoriaSchema,
  actualizarMarcaSchema,
  crearCategoriaSchema,
  crearMarcaSchema,
} from "@/lib/validations/clasificacion";
import {
  actualizarDepositoSchema,
  cambiarActivoSchema,
  crearDepositoSchema,
} from "@/lib/validations/deposito";
import { actionHandler } from "@/server/action-handler";
import { actorDe } from "@/server/auth/actor";
import { requirePermiso } from "@/server/auth/permissions";
import {
  actualizarCategoria,
  cambiarActivoCategoria,
  crearCategoria,
} from "@/server/services/categoria.service";
import {
  actualizarDeposito,
  cambiarActivoDeposito,
  crearDeposito,
} from "@/server/services/deposito.service";
import { actualizarMarca, cambiarActivoMarca, crearMarca } from "@/server/services/marca.service";

/** CONFIGURACION: crear → alta · editar → modificar y activar/desactivar. */

function revalidar(ruta: string) {
  revalidatePath(ruta);
  revalidatePath("/inventario");
  revalidatePath("/productos", "layout");
}

// --- Depósitos ---
export const crearDepositoAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.CONFIGURACION, "crear");
  const r = await crearDeposito(crearDepositoSchema.parse(input), await actorDe(usuario));
  revalidar("/configuracion/depositos");
  return r;
});
export const actualizarDepositoAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.CONFIGURACION, "editar");
  const r = await actualizarDeposito(actualizarDepositoSchema.parse(input), await actorDe(usuario));
  revalidar("/configuracion/depositos");
  return r;
});
export const activoDepositoAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.CONFIGURACION, "editar");
  const { id, activo } = cambiarActivoSchema.parse(input);
  await cambiarActivoDeposito(id, activo, await actorDe(usuario));
  revalidar("/configuracion/depositos");
  return null;
});

// --- Categorías ---
export const crearCategoriaAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.CONFIGURACION, "crear");
  const r = await crearCategoria(crearCategoriaSchema.parse(input), await actorDe(usuario));
  revalidar("/configuracion/categorias");
  return r;
});
export const actualizarCategoriaAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.CONFIGURACION, "editar");
  const r = await actualizarCategoria(
    actualizarCategoriaSchema.parse(input),
    await actorDe(usuario),
  );
  revalidar("/configuracion/categorias");
  return r;
});
export const activoCategoriaAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.CONFIGURACION, "editar");
  const { id, activo } = cambiarActivoSchema.parse(input);
  await cambiarActivoCategoria(id, activo, await actorDe(usuario));
  revalidar("/configuracion/categorias");
  return null;
});

// --- Marcas ---
export const crearMarcaAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.CONFIGURACION, "crear");
  const r = await crearMarca(crearMarcaSchema.parse(input), await actorDe(usuario));
  revalidar("/configuracion/marcas");
  return r;
});
export const actualizarMarcaAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.CONFIGURACION, "editar");
  const r = await actualizarMarca(actualizarMarcaSchema.parse(input), await actorDe(usuario));
  revalidar("/configuracion/marcas");
  return r;
});
export const activoMarcaAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.CONFIGURACION, "editar");
  const { id, activo } = cambiarActivoSchema.parse(input);
  await cambiarActivoMarca(id, activo, await actorDe(usuario));
  revalidar("/configuracion/marcas");
  return null;
});
