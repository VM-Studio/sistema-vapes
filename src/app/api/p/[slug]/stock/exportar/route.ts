import { Modulo } from "@prisma/client";

import { esOwner } from "@/lib/permisos";
import { paramsComoObjeto, respuestaCSV, respuestaExcel } from "@/server/auth/descarga";
import { mapearErrorHttp } from "@/server/auth/http";
import { requireCtx } from "@/server/auth/permissions";
import { ForbiddenError } from "@/server/errors";
import {
  exportarStockCSV,
  exportarStockExcel,
  filtrosStockSchema,
} from "@/server/services/inventario.service";

export const runtime = "nodejs";

/**
 * GET /api/p/{slug}/stock/exportar?formato=csv|xlsx&... → el stock del panel
 * que se está viendo (mismos filtros; `depositoId` = un galpón, sin él =
 * Global). Solo dueños. Sin costos.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireCtx(Modulo.STOCK, "ver");
    if (!esOwner(ctx.usuario)) throw new ForbiddenError("Exportar el stock es solo para dueños.");
    const params = paramsComoObjeto(req.url);
    const filtros = filtrosStockSchema.parse(params);
    const nombre = `stock-${ctx.panel.slug}`;
    if (params.formato === "csv") return respuestaCSV(await exportarStockCSV(ctx, filtros), nombre);
    return respuestaExcel(await exportarStockExcel(ctx, filtros), nombre);
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
