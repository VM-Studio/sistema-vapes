import { Modulo } from "@prisma/client";

import { paramsComoObjeto, respuestaCSV, respuestaExcel } from "@/server/auth/descarga";
import { mapearErrorHttp } from "@/server/auth/http";
import { requireCtx } from "@/server/auth/permissions";
import {
  exportarStockCSV,
  exportarStockExcel,
  filtrosStockSchema,
} from "@/server/services/inventario.service";

export const runtime = "nodejs";

/**
 * GET /api/p/{slug}/stock/exportar?formato=xlsx|csv&... → el stock del panel
 * que se está viendo (mismos filtros y mismo depósito, o Global). Sin costos.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireCtx(Modulo.STOCK, "ver");
    const params = paramsComoObjeto(req.url);
    const filtros = filtrosStockSchema.parse(params);
    const nombre = `stock-${ctx.panel.slug}`;
    if (params.formato === "csv") return respuestaCSV(await exportarStockCSV(ctx, filtros), nombre);
    return respuestaExcel(await exportarStockExcel(ctx, filtros), nombre);
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
