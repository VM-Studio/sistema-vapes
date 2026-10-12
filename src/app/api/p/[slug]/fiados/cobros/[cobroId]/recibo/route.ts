import { Modulo } from "@prisma/client";

import { mapearErrorHttp } from "@/server/auth/http";
import { requireCtx } from "@/server/auth/permissions";
import { respuestaPdf } from "@/server/pdf-http";
import { pdfReciboCobro } from "@/server/services/recibo-cobro.service";

export const runtime = "nodejs";

/**
 * GET /api/p/{slug}/fiados/cobros/{cobroId}/recibo → recibo PDF del cobro,
 * inline. Permiso FIADOS "ver". Se genera en el momento (cacheado en el storage).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ cobroId: string }> }) {
  try {
    const ctx = await requireCtx(Modulo.FIADOS, "ver");
    const { pdf, archivo } = await pdfReciboCobro(ctx, decodeURIComponent((await params).cobroId));
    return respuestaPdf(pdf, archivo);
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
