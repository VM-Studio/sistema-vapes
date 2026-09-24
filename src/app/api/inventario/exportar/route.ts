import { Modulo } from "@prisma/client";

import { esOwner } from "@/lib/permisos";
import { paramsComoObjeto, respuestaCSV } from "@/server/auth/descarga";
import { mapearErrorHttp } from "@/server/auth/http";
import { requirePermiso } from "@/server/auth/permissions";
import {
  exportarInventarioCSV,
  filtrosInventarioSchema,
} from "@/server/services/inventario.service";

export const runtime = "nodejs";

/** Exporta lo que se está viendo (mismos filtros). La valorización solo sale para OWNER. */
export async function GET(req: Request) {
  try {
    const usuario = await requirePermiso(Modulo.INVENTARIO, "ver");
    const filtros = filtrosInventarioSchema.parse(paramsComoObjeto(req.url));
    const csv = await exportarInventarioCSV(filtros, { incluirValorizacion: esOwner(usuario) });
    return respuestaCSV(csv, "inventario");
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
