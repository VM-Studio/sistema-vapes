import { mapearErrorHttp } from "@/server/auth/http";
import { metaDesdeHeaders } from "@/server/auth/request-meta";
import { respuestaPdf } from "@/server/pdf-http";
import { consumir } from "@/server/seguridad/rate-limit";
import { estadoToken, pdfRemito } from "@/server/services/remito-liquidacion.service";

export const runtime = "nodejs";

/**
 * GET /api/publico/remito/{token} → el remito PDF del link de firma, sin
 * sesión: mientras el link es válido y, ya firmado, para bajar el final.
 * Vencido o inexistente → 404. Rate limit por IP.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const ip = metaDesdeHeaders(req.headers).ip ?? "local";
    const r = await consumir(`firma-pdf:${ip}`, 30);
    if (!r.permitido)
      return new Response("Demasiadas solicitudes", {
        status: 429,
        headers: { "Retry-After": String(r.reintentarEnSegundos) },
      });
    const e = await estadoToken((await params).token);
    if (e.estado !== "VALIDO" && e.estado !== "USADO")
      return new Response("No encontrado", { status: 404 });
    const { pdf, archivo } = await pdfRemito(e.panelId, e.liquidacionId);
    return respuestaPdf(pdf, archivo);
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
