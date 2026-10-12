import { mapearErrorHttp } from "@/server/auth/http";
import { dbPara } from "@/server/db/panel-scoped";
import { respuestaPdf, verificarLinkPublico, type TipoPdfPublico } from "@/server/pdf-http";
import { pdfCotizacion } from "@/server/services/cotizacion.service";
import { pdfRemito } from "@/server/services/transferencia.service";

export const runtime = "nodejs";

const TIPOS: readonly TipoPdfPublico[] = ["cotizacion", "remito"];

/**
 * GET /api/publico/pdf/{tipo}/{panelId}/{id}/{firma} — el PDF que se manda
 * por WhatsApp (cotización al cliente, remito al galpón), sin sesión. La
 * firma (HMAC con AUTH_SECRET, ver `rutaPublicaPdf`) es la llave: sin ella,
 * 404. Se genera en el momento (cacheado), así el link nunca se rompe aunque
 * el storage sea efímero.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ tipo: string; panelId: string; id: string; firma: string }> },
) {
  try {
    const { tipo, panelId, id, firma } = await params;
    const t = TIPOS.find((x) => x === tipo);
    if (!t || !verificarLinkPublico(t, panelId, id, firma))
      return new Response("No encontrado", { status: 404 });
    const db = dbPara(panelId);
    // El autor del documento hace de usuario del contexto (solo lectura).
    const autor =
      t === "cotizacion"
        ? (
            await db.cotizacion.findFirst({
              where: { id, deletedAt: null },
              select: { vendedorId: true },
            })
          )?.vendedorId
        : (await db.transferencia.findFirst({ where: { id }, select: { usuarioId: true } }))
            ?.usuarioId;
    if (!autor) return new Response("No encontrado", { status: 404 });
    const ctx = { panelId, usuarioId: autor };
    const { pdf, archivo } =
      t === "cotizacion" ? await pdfCotizacion(ctx, id) : await pdfRemito(ctx, id);
    return respuestaPdf(pdf, archivo);
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
