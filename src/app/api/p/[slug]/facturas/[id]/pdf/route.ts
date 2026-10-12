import { Modulo } from "@prisma/client";

import { mapearErrorHttp } from "@/server/auth/http";
import { requireCtx } from "@/server/auth/permissions";
import { respuestaPdf } from "@/server/pdf-http";
import { pdfFactura } from "@/server/services/factura.service";

export const runtime = "nodejs";

/**
 * GET /api/p/{slug}/facturas/{id}/pdf → la factura, inline: el PDF subido (la
 * factura real) o el comprobante que genera el sistema. `?generado=1` fuerza
 * el comprobante generado. Permiso FACTURAS "ver".
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireCtx(Modulo.FACTURAS, "ver");
    const generado = new URL(req.url).searchParams.get("generado") === "1";
    const { pdf, archivo } = await pdfFactura(ctx, decodeURIComponent((await params).id), {
      generado,
    });
    return respuestaPdf(pdf, archivo);
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
