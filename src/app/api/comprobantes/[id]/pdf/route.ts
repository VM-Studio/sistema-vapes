import { Modulo } from "@prisma/client";

import { mapearErrorHttp } from "@/server/auth/http";
import { requirePermiso } from "@/server/auth/permissions";
import { obtenerPdfComprobante } from "@/server/services/comprobante.service";

export const runtime = "nodejs";

/** GET /api/comprobantes/<id>/pdf?formato=ticket|a4[&descargar=1] — con sesión y permiso de ver ventas. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermiso(Modulo.VENTAS, "ver");
    const { id } = await params;
    const url = new URL(req.url);
    const formato = url.searchParams.get("formato") === "a4" ? "a4" : "ticket";
    const r = await obtenerPdfComprobante(id, formato);
    const disposicion = url.searchParams.get("descargar") ? "attachment" : "inline";
    return new Response(Buffer.from(r.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposicion}; filename="${formato === "a4" ? r.nombre.replace(".pdf", "-a4.pdf") : r.nombre}"`,
        "Cache-Control": "no-store",
        ...(r.url ? { "X-Url-Publica": r.url } : {}),
      },
    });
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
