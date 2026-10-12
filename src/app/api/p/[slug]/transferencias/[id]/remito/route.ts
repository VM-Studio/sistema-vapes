import { Modulo } from "@prisma/client";

import { mapearErrorHttp } from "@/server/auth/http";
import { requireCtx } from "@/server/auth/permissions";
import { respuestaPdf } from "@/server/pdf-http";
import { pdfRemito } from "@/server/services/transferencia.service";

export const runtime = "nodejs";

/**
 * GET /api/p/{slug}/transferencias/{id}/remito → el remito PDF, inline.
 * Permiso STOCK "ver". Se genera en el momento (cacheado en el storage).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireCtx(Modulo.STOCK, "ver");
    const { pdf, archivo } = await pdfRemito(ctx, (await params).id);
    return respuestaPdf(pdf, archivo);
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
