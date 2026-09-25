"use server";

import { Modulo } from "@prisma/client";
import { z } from "zod";

import { normalizarCodigoBarras } from "@/lib/barcode";
import { esOwner, puede, type UsuarioSesion } from "@/lib/permisos";
import { id } from "@/lib/validations/common";
import { actionHandler } from "@/server/action-handler";
import { requirePermisoAlguno } from "@/server/auth/permissions";
import {
  buscarPorCodigo,
  obtenerVarianteEncontrada,
  type VarianteEncontrada,
} from "@/server/services/producto.service";

import type { ResultadoResolucion, VarianteEscaneada } from "./tipos";

/** Módulos desde los que se escanea (cualquiera con "ver" alcanza para resolver un código). */
const MODULOS_ESCANEO = [
  Modulo.INVENTARIO,
  Modulo.MOVIMIENTOS,
  Modulo.COMPRAS,
  Modulo.PRODUCTOS,
  Modulo.VENTAS,
];

/** El costo solo lo ve el dueño o quien carga compras (lo necesita para el costo unitario). */
function ocultarCosto(v: VarianteEncontrada, usuario: UsuarioSesion): VarianteEscaneada {
  const veCosto = esOwner(usuario) || puede(usuario, Modulo.COMPRAS, "crear");
  return { ...v, precioCosto: veCosto ? v.precioCosto : null };
}

/** resolverCodigo(codigo): lo usa todo escaneo (pistola, cámara o manual). */
export const resolverCodigoAction = actionHandler(
  async (input: unknown): Promise<ResultadoResolucion> => {
    const usuario = await requirePermisoAlguno(MODULOS_ESCANEO, "ver");
    const { codigo } = z.object({ codigo: z.string().trim().min(1).max(80) }).parse(input);
    const v = await buscarPorCodigo(codigo);
    return v
      ? { encontrado: true, variante: ocultarCosto(v, usuario) }
      : { encontrado: false, codigo: normalizarCodigoBarras(codigo) };
  },
);

/** Igual pero por id (al volver de "crear producto" con el código escaneado). */
export const resolverVarianteAction = actionHandler(
  async (input: unknown): Promise<VarianteEscaneada | null> => {
    const usuario = await requirePermisoAlguno(MODULOS_ESCANEO, "ver");
    const { varianteId } = z.object({ varianteId: id }).parse(input);
    const v = await obtenerVarianteEncontrada(varianteId);
    return v ? ocultarCosto(v, usuario) : null;
  },
);
