"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { esOwner } from "@/lib/permisos";
import { actualizarClienteSchema, crearClienteSchema } from "@/lib/validations/cliente";
import { id } from "@/lib/validations/common";
import { actionHandler } from "@/server/action-handler";
import { actorDe } from "@/server/auth/actor";
import { requirePermiso } from "@/server/auth/permissions";
import {
  actualizarCliente,
  crearCliente,
  darDeBajaCliente,
} from "@/server/services/cliente.service";

/** CLIENTES: crear → alta · editar → datos · eliminar → baja. El límite de crédito, solo OWNER. */

export const crearClienteAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.CLIENTES, "crear");
  const r = await crearCliente(crearClienteSchema.parse(input), await actorDe(usuario), {
    puedeDefinirLimite: esOwner(usuario),
  });
  revalidatePath("/clientes");
  return r;
});

export const actualizarClienteAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.CLIENTES, "editar");
  const datos = actualizarClienteSchema.parse(input);
  const r = await actualizarCliente(datos, await actorDe(usuario), {
    puedeDefinirLimite: esOwner(usuario),
  });
  revalidatePath("/clientes", "layout");
  return r;
});

export const darDeBajaClienteAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.CLIENTES, "eliminar");
  const { id: clienteId } = z.object({ id }).parse(input);
  await darDeBajaCliente(clienteId, await actorDe(usuario));
  revalidatePath("/clientes", "layout");
});
