"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { id } from "@/lib/validations/common";
import {
  actualizarPreciosSchema,
  actualizarProductoSchema,
  aumentoPorcentualSchema,
  codigoAlternativoSchema,
  productoSchema,
  verificarCodigoSchema,
} from "@/lib/validations/producto";
import { actionHandler } from "@/server/action-handler";
import { actorDe } from "@/server/auth/actor";
import { requirePermiso, requireUsuario } from "@/server/auth/permissions";
import { puede } from "@/lib/permisos";
import { ForbiddenError, ValidationError } from "@/server/errors";
import {
  actualizarPrecios,
  actualizarProducto,
  agregarCodigoAlternativo,
  aplicarAumentoPorcentual,
  asignarCodigosInternos,
  crearProducto,
  darDeBajaProducto,
  generarCodigoInterno,
  importarProductosCSV,
  previsualizarAumento,
  previsualizarImportacion,
  quitarCodigoAlternativo,
  verificarCodigoDisponible,
} from "@/server/services/producto.service";

/**
 * Permisos del módulo PRODUCTOS:
 *   ver → listado, ficha, exportar · crear → nuevo, importar
 *   editar → editar, precios, aumento masivo, códigos alternativos · eliminar → dar de baja
 */

function revalidar(productoId?: string) {
  revalidatePath("/productos");
  if (productoId) revalidatePath(`/productos/${productoId}`);
  revalidatePath("/inventario");
}

export const crearProductoAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.PRODUCTOS, "crear");
  const r = await crearProducto(productoSchema.parse(input), await actorDe(usuario));
  revalidar(r.id);
  return r;
});

export const actualizarProductoAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.PRODUCTOS, "editar");
  const { id: productoId, datos } = actualizarProductoSchema.parse(input);
  const r = await actualizarProducto(productoId, datos, await actorDe(usuario));
  revalidar(productoId);
  return r;
});

export const darDeBajaProductoAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.PRODUCTOS, "eliminar");
  const { id: productoId } = z.object({ id }).parse(input);
  await darDeBajaProducto(productoId, await actorDe(usuario));
  revalidar(productoId);
  return null;
});

/** Validación en vivo del código de barras en el formulario (con debounce). */
export const verificarCodigoAction = actionHandler(async (input: unknown) => {
  await requirePermiso(Modulo.PRODUCTOS, "ver");
  const { codigo, excluirVarianteId } = verificarCodigoSchema.parse(input);
  return verificarCodigoDisponible(codigo, excluirVarianteId);
});

export const actualizarPreciosAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.PRODUCTOS, "editar");
  const { varianteIds, precioCosto, precioVenta, motivo } = actualizarPreciosSchema.parse(input);
  const r = await actualizarPrecios(
    varianteIds,
    { precioCosto, precioVenta },
    await actorDe(usuario),
    motivo,
  );
  revalidar();
  revalidatePath("/productos", "layout");
  return r;
});

export const previsualizarAumentoAction = actionHandler(async (input: unknown) => {
  await requirePermiso(Modulo.PRODUCTOS, "editar");
  return previsualizarAumento(aumentoPorcentualSchema.parse(input));
});

export const aplicarAumentoAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.PRODUCTOS, "editar");
  const r = await aplicarAumentoPorcentual(
    aumentoPorcentualSchema.parse(input),
    await actorDe(usuario),
  );
  revalidatePath("/productos", "layout");
  revalidar();
  return r;
});

export const agregarCodigoAlternativoAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.PRODUCTOS, "editar");
  const { varianteId, codigo, descripcion } = codigoAlternativoSchema.parse(input);
  const r = await agregarCodigoAlternativo(varianteId, codigo, descripcion, await actorDe(usuario));
  revalidatePath("/productos", "layout");
  return r;
});

export const quitarCodigoAlternativoAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.PRODUCTOS, "editar");
  const { id: altId } = z.object({ id }).parse(input);
  await quitarCodigoAlternativo(altId, await actorDe(usuario));
  revalidatePath("/productos", "layout");
  return null;
});

const MAX_CSV_BYTES = 5 * 1024 * 1024;

async function leerArchivo(formData: FormData): Promise<Uint8Array> {
  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) {
    throw new ValidationError("Elegí un archivo CSV", { archivo: ["Elegí un archivo CSV"] });
  }
  if (archivo.size > MAX_CSV_BYTES)
    throw new ValidationError("El archivo supera los 5 MB", { archivo: ["Máximo 5 MB"] });
  return new Uint8Array(await archivo.arrayBuffer());
}

/** Paso 1: valida TODO el archivo y devuelve el reporte por fila. No escribe nada. */
export const previsualizarImportacionAction = actionHandler(async (formData: FormData) => {
  await requirePermiso(Modulo.PRODUCTOS, "crear");
  return previsualizarImportacion(await leerArchivo(formData));
});

/** Paso 2: vuelve a validar en el servidor e importa todo o nada. */
export const importarCSVAction = actionHandler(async (formData: FormData) => {
  const usuario = await requirePermiso(Modulo.PRODUCTOS, "crear");
  const r = await importarProductosCSV(await leerArchivo(formData), await actorDe(usuario));
  if (r.importado) revalidar();
  return r;
});

/** Código interno libre ({prefijo}{7 dígitos}{verificador}) para completar el formulario (no lo reserva). */
export const generarCodigoInternoAction = actionHandler(async () => {
  // Crear un producto nuevo o editar uno existente: alcanza cualquiera de los dos.
  const usuario = await requireUsuario();
  if (!puede(usuario, Modulo.PRODUCTOS, "crear") && !puede(usuario, Modulo.PRODUCTOS, "editar")) {
    throw new ForbiddenError("No tenés permiso para crear ni editar productos.");
  }
  return { codigo: await generarCodigoInterno() };
});

/** Asigna un código interno a una variante existente que no tiene código (para etiquetarla). */
export const asignarCodigoInternoAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.PRODUCTOS, "editar");
  const { varianteId } = z.object({ varianteId: id }).parse(input);
  const r = await asignarCodigosInternos([varianteId], await actorDe(usuario));
  const asignado = r.asignados[0];
  if (!asignado)
    throw new ValidationError("La variante ya tiene código de barras", {
      varianteId: ["Ya tiene código"],
    });
  revalidatePath("/productos", "layout");
  return asignado;
});
