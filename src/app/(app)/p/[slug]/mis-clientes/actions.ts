"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { tieneCarteraClientes } from "@/lib/permisos";
import {
  actualizarClienteSchema,
  crearClienteSchema,
  telefonoConsultaSchema,
} from "@/lib/validations/cliente";
import { id } from "@/lib/validations/common";
import { actionHandler } from "@/server/action-handler";
import { requireCtxPanelUsuario } from "@/server/auth/permissions";
import { ForbiddenError } from "@/server/errors";
import {
  agregarACartera,
  editarClienteDeCartera,
  importarCartera,
  quitarDeCartera,
  telefonoEnCartera,
} from "@/server/services/cartera-clientes.service";

/**
 * «Mis clientes» (la cartera del vendedor logueado, en el panel actual). Solo
 * vendedores con cartera (EMPLEADO con VENTAS crear): cada uno toca lo suyo.
 */
async function requireCartera() {
  const ctx = await requireCtxPanelUsuario();
  if (!tieneCarteraClientes(ctx.usuario, ctx.panelId))
    throw new ForbiddenError("«Mis clientes» es para los vendedores.");
  return ctx;
}

function revalidar() {
  revalidatePath("/p/[slug]/mis-clientes", "layout");
  revalidatePath("/p/[slug]/clientes", "layout");
}

/** «Ya lo tenía»: alta en la cartera sin venta (no cuenta como cliente nuevo). */
export const agregarClienteCarteraAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCartera();
  const { sumarExistente, ...datos } = crearClienteSchema
    .extend({ sumarExistente: z.boolean().default(false) })
    .parse(input);
  const r = await agregarACartera(ctx, ctx.usuarioId, datos, { sumarExistente });
  revalidar();
  return r;
});

/** «Cargar varios»: una línea por cliente (nombre y teléfono). */
export const importarCarteraAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCartera();
  const { texto } = z.object({ texto: z.string().max(60_000) }).parse(input);
  const r = await importarCartera(ctx, ctx.usuarioId, texto);
  revalidar();
  return r;
});

export const editarClienteCarteraAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCartera();
  const r = await editarClienteDeCartera(ctx, ctx.usuarioId, actualizarClienteSchema.parse(input));
  revalidar();
  return r;
});

export const quitarClienteCarteraAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCartera();
  const { id: clienteId } = z.object({ id }).parse(input);
  await quitarDeCartera(ctx, ctx.usuarioId, clienteId);
  revalidar();
  return null;
});

export const telefonoEnCarteraAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCartera();
  const { telefono } = telefonoConsultaSchema.parse(input);
  return telefonoEnCartera(ctx, ctx.usuarioId, telefono);
});
