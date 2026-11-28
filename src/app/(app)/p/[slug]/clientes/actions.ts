"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  actualizarClienteSchema,
  asignarOrigenesSchema,
  buscarClientesSchema,
  crearClienteSchema,
  telefonoConsultaSchema,
} from "@/lib/validations/cliente";
import { esOwner, tieneCarteraClientes } from "@/lib/permisos";
import { id } from "@/lib/validations/common";
import { actionHandler } from "@/server/action-handler";
import { requireCtx, requireCtxAlguno, requireCtxOwner } from "@/server/auth/permissions";
import {
  actualizarCliente,
  asignarOrigenes,
  buscarClientes,
  clientePorTelefono,
  crearCliente,
  desactivarCliente,
  eliminarCliente,
  listarOrigenesCliente,
  reactivarCliente,
} from "@/server/services/cliente.service";

/** Desde dónde se elige un cliente (SelectorCliente). */
// FIADOS: «Cargar fiado anterior» elige (o da de alta) al cliente que debe.
const MODULOS_SELECTOR = [
  Modulo.CLIENTES,
  Modulo.VENTAS,
  Modulo.DEVOLUCIONES,
  Modulo.COTIZADOR,
  Modulo.FIADOS,
];

/** CLIENTES (en el panel actual): crear → alta · editar → datos · eliminar → desactivar · dueños: eliminar (borrado lógico). */

export const crearClienteAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.CLIENTES, "crear");
  // Un vendedor que carga un cliente desde Clientes lo suma a su cartera (ya lo tenía: no es nuevo).
  const r = await crearCliente(ctx, crearClienteSchema.parse(input), undefined, {
    vendedorId: tieneCarteraClientes(ctx.usuario, ctx.panelId) ? ctx.usuarioId : null,
  });
  revalidatePath("/p/[slug]/clientes", "page");
  return r;
});

export const actualizarClienteAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.CLIENTES, "editar");
  // «De quién viene» define la ganancia de cliente nuevo: solo lo cambian los dueños.
  const r = await actualizarCliente(ctx, actualizarClienteSchema.parse(input), {
    puedeCambiarOrigen: esOwner(ctx.usuario),
  });
  revalidatePath("/p/[slug]/clientes", "layout");
  return r;
});

export const desactivarClienteAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.CLIENTES, "eliminar");
  const { id: clienteId } = z.object({ id }).parse(input);
  await desactivarCliente(ctx, clienteId);
  revalidatePath("/p/[slug]/clientes", "layout");
});

export const reactivarClienteAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.CLIENTES, "editar");
  const { id: clienteId } = z.object({ id }).parse(input);
  await reactivarCliente(ctx, clienteId);
  revalidatePath("/p/[slug]/clientes", "layout");
});

/** Opciones de «¿De quién viene este cliente?» (dueños y vendedores del panel). */
export const origenesClienteAction = actionHandler(async () => {
  const ctx = await requireCtxAlguno(MODULOS_SELECTOR, "ver");
  return listarOrigenesCliente(ctx);
});

/** Dueños: completar «de quién viene» de los clientes que ya estaban cargados. */
export const asignarOrigenesAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const { asignaciones } = asignarOrigenesSchema.parse(input);
  const cambiados = await asignarOrigenes(ctx, asignaciones);
  revalidatePath("/p/[slug]", "layout");
  return { cambiados };
});

/** Eliminar (borrado lógico): solo dueños. Con deuda de fiado, no. */
export const eliminarClienteAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const { id: clienteId } = z.object({ id }).parse(input);
  await eliminarCliente(ctx, clienteId);
  revalidatePath("/p/[slug]", "layout");
});

/** Buscador del SelectorCliente (nombre o teléfono, máx. 20, con última compra). */
export const buscarClientesAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxAlguno(MODULOS_SELECTOR, "ver");
  const { q } = buscarClientesSchema.parse(input);
  return buscarClientes(ctx, q);
});

/** Validación en vivo del teléfono de un cliente nuevo: ¿ya es de alguien? */
export const clientePorTelefonoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxAlguno(MODULOS_SELECTOR, "ver");
  const { telefono } = telefonoConsultaSchema.parse(input);
  return clientePorTelefono(ctx, telefono);
});
