import { mapearErrorHttp } from "@/server/auth/http";
import { streamExcelReporte } from "@/server/reportes/excel-reporte";
import { pdfDeReporte, prepararReporte } from "@/server/reportes/exportar";

export const runtime = "nodejs";

/**
 * GET /api/reportes/<slug>?formato=pdf|xlsx&periodo=…&deposito=…
 * Genera el archivo en el servidor. Excel sale por streaming (las filas se
 * escriben mientras se generan); el PDF, entero. 403 si falta el permiso
 * (REPORTES, y FINANZAS en los reportes de dinero).
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const url = new URL(req.url);
    if (url.searchParams.get("formato") === "xlsx") {
      const { doc, meta, nombre } = await prepararReporte(slug, url.searchParams);
      return new Response(streamExcelReporte(doc, meta), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${nombre}.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    }
    const { pdf, nombre } = await pdfDeReporte(slug, url.searchParams);
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${url.searchParams.get("ver") ? "inline" : "attachment"}; filename="${nombre}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
