import { Modulo } from "@prisma/client";

import { listarFacturasSchema } from "@/lib/validations/factura";
import { paramsComoObjeto, respuestaExcel } from "@/server/auth/descarga";
import { mapearErrorHttp } from "@/server/auth/http";
import { requireCtx } from "@/server/auth/permissions";
import { exportarExcel } from "@/server/reportes/exportar";
import { ForbiddenError } from "@/server/errors";
import { exportarFacturas } from "@/server/services/factura.service";
import { veFacturadoCtx } from "@/server/services/ganancia-vendedor.service";
import { nombreNegocio } from "@/server/services/identidad.service";

export const runtime = "nodejs";

/**
 * GET /api/p/{slug}/facturas/exportar?desde&hasta&tipo&estado → Excel de las
 * facturas del período (para el contador): neto, IVA y total, con los
 * totales de las emitidas. Permiso FACTURAS "ver" (y ver lo facturado).
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireCtx(Modulo.FACTURAS, "ver");
    // Trae los totales facturados: un vendedor con ganancia por vape no los ve.
    if (!(await veFacturadoCtx(ctx)))
      throw new ForbiddenError("No tenés acceso a los totales facturados.");
    const filtros = listarFacturasSchema.parse(paramsComoObjeto(req.url));
    const e = await exportarFacturas(ctx, filtros);
    const libro = await exportarExcel(
      { negocio: await nombreNegocio(), panel: ctx.panel.nombre, logoUrl: ctx.panel.logoUrl },
      e,
    );
    return respuestaExcel(libro, `${e.archivo}-${ctx.panel.slug}`);
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
