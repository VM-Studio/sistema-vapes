import { mapearErrorHttp } from "@/server/auth/http";
import { requireCtxPanelUsuario } from "@/server/auth/permissions";
import { respuestaPdf } from "@/server/pdf-http";
import { pdfRemitoParaUsuario } from "@/server/services/remito-liquidacion.service";

export const runtime = "nodejs";

/**
 * GET /api/p/{slug}/liquidaciones/{id}/remito → remito de pago PDF (con las
 * firmas que tenga), inline. Dueños, o el vendedor de la liquidación.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireCtxPanelUsuario();
    const { pdf, archivo } = await pdfRemitoParaUsuario(ctx, decodeURIComponent((await params).id));
    return respuestaPdf(pdf, archivo);
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
