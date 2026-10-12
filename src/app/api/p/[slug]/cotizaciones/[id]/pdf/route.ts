import { Modulo } from "@prisma/client";

import { mapearErrorHttp } from "@/server/auth/http";
import { requireCtx } from "@/server/auth/permissions";
import { respuestaPdf } from "@/server/pdf-http";
import { pdfCotizacion } from "@/server/services/cotizacion.service";

export const runtime = "nodejs";

/**
 * GET /api/p/{slug}/cotizaciones/{id}/pdf → el PDF de la cotización, inline.
 * Permiso COTIZADOR "ver". Se genera en el momento (cacheado en el storage).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireCtx(Modulo.COTIZADOR, "ver");
    const { pdf, archivo } = await pdfCotizacion(ctx, (await params).id);
    return respuestaPdf(pdf, archivo);
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
