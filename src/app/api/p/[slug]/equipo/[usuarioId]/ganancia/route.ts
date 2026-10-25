import { paramsComoObjeto, respuestaExcel } from "@/server/auth/descarga";
import { mapearErrorHttp } from "@/server/auth/http";
import { requireCtxPanelUsuario } from "@/server/auth/permissions";
import { esMes } from "@/lib/ganancia-vendedor";
import { exportarGananciaExcel, mesActual } from "@/server/services/ganancia-vendedor.service";

export const runtime = "nodejs";

/**
 * GET /api/p/{slug}/equipo/{usuarioId}/ganancia?mes=YYYY-MM → Excel con la
 * ganancia por vape del mes (resumen por categoría + ventas y devoluciones).
 * Dueños: de cualquier vendedor; el vendedor, solo la suya (403 si no).
 */
export async function GET(req: Request, { params }: { params: Promise<{ usuarioId: string }> }) {
  try {
    const ctx = await requireCtxPanelUsuario();
    const { usuarioId } = await params;
    const { mes } = paramsComoObjeto(req.url);
    const { buffer, nombre } = await exportarGananciaExcel(
      ctx,
      usuarioId,
      esMes(mes) ? mes : mesActual(),
    );
    return respuestaExcel(buffer, nombre);
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
