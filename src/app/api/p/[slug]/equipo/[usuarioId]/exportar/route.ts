import { paramsComoObjeto, respuestaExcel } from "@/server/auth/descarga";
import { mapearErrorHttp } from "@/server/auth/http";
import { requireCtxOwner } from "@/server/auth/permissions";
import {
  exportarVentasVendedorExcel,
  periodoDesdeParams,
} from "@/server/services/analitica.service";

export const runtime = "nodejs";

/**
 * GET /api/p/{slug}/equipo/{usuarioId}/exportar?modo=…&desde&hasta&preset →
 * Excel con todas las ventas del vendedor en el período. Solo dueños (403 si no).
 */
export async function GET(req: Request, { params }: { params: Promise<{ usuarioId: string }> }) {
  try {
    const ctx = await requireCtxOwner();
    const { usuarioId } = await params;
    const periodo = periodoDesdeParams(paramsComoObjeto(req.url));
    const { buffer, nombre } = await exportarVentasVendedorExcel(ctx, usuarioId, periodo);
    return respuestaExcel(buffer, nombre);
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
