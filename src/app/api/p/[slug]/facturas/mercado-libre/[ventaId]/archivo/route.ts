import { Modulo } from "@prisma/client";

import { mapearErrorHttp } from "@/server/auth/http";
import { requireCtx } from "@/server/auth/permissions";
import { archivoFacturaML } from "@/server/services/factura-ml.service";

export const runtime = "nodejs";

/** Nombre seguro para Content-Disposition (ASCII, sin comillas). */
const nombreSeguro = (n: string) =>
  n
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]/g, "-");

/**
 * GET /api/p/{slug}/facturas/mercado-libre/{ventaId}/archivo → el archivo
 * (PDF o imagen) de la factura cargada de una venta Mercado Libre, inline;
 * `?descargar=1` lo baja. Permiso FACTURAS "ver".
 */
export async function GET(req: Request, { params }: { params: Promise<{ ventaId: string }> }) {
  try {
    const ctx = await requireCtx(Modulo.FACTURAS, "ver");
    const descargar = new URL(req.url).searchParams.get("descargar") === "1";
    const { datos, tipo, nombre } = await archivoFacturaML(
      ctx,
      decodeURIComponent((await params).ventaId),
    );
    return new Response(Buffer.from(datos), {
      headers: {
        "Content-Type": tipo,
        "Content-Disposition": `${descargar ? "attachment" : "inline"}; filename="${nombreSeguro(nombre)}"`,
        "Content-Length": String(datos.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
