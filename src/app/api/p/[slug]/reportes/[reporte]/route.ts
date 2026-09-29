import { Modulo } from "@prisma/client";

import { paramsComoObjeto, respuestaExcel } from "@/server/auth/descarga";
import { mapearErrorHttp } from "@/server/auth/http";
import { requireCtx } from "@/server/auth/permissions";
import { armarExportacion, exigirAccesoReporte } from "@/server/reportes/armar";
import { exportarExcel, exportarPDF, type CabeceraPanel } from "@/server/reportes/exportar";
import { mesResumen } from "@/server/reportes/filtros";
import { datosResumenMensual, pdfResumenMensual } from "@/server/reportes/resumen-mensual";
import { nombreNegocio } from "@/server/services/identidad.service";

export const runtime = "nodejs";

/**
 * GET /api/p/{slug}/reportes/{reporte}?formato=pdf|xlsx&<filtros de la página>
 * → el reporte tal como se ve (mismos filtros), con cabecera del panel.
 * Permiso REPORTES "ver"; los reportes de dueños responden 403 al resto.
 * `resumen-mensual`: solo PDF, `?mes=YYYY-MM`.
 */
export async function GET(req: Request, { params }: { params: Promise<{ reporte: string }> }) {
  try {
    const ctx = await requireCtx(Modulo.REPORTES, "ver");
    const clave = exigirAccesoReporte(ctx, (await params).reporte);
    const query = paramsComoObjeto(req.url);
    const cab: CabeceraPanel = {
      negocio: await nombreNegocio(),
      panel: ctx.panel.nombre,
      logoUrl: ctx.panel.logoUrl,
    };
    const fecha = new Date().toISOString().slice(0, 10);
    if (clave === "resumen-mensual") {
      const mes = mesResumen(query.mes);
      const pdf = await pdfResumenMensual(cab, await datosResumenMensual(ctx, mes));
      return pdfRespuesta(pdf, `resumen-${ctx.panel.slug}-${mes}.pdf`);
    }
    const e = await armarExportacion(ctx, clave, query);
    if (query.formato === "xlsx") return respuestaExcel(await exportarExcel(cab, e), e.archivo);
    return pdfRespuesta(await exportarPDF(cab, e), `${e.archivo}-${fecha}.pdf`);
  } catch (error) {
    return mapearErrorHttp(error);
  }
}

function pdfRespuesta(pdf: Uint8Array, archivo: string) {
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${archivo}"`,
      "Cache-Control": "no-store",
    },
  });
}
