import { mapearErrorHttp } from "@/server/auth/http";
import { requireAccesoCaja } from "@/server/auth/caja-acceso";
import { pdfCierreCaja } from "@/server/reportes/cierre-caja";

export const runtime = "nodejs";

/** GET /api/caja/<id>/pdf — "Z de caja" (cierre) o el estado de una caja abierta. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const usuario = await requireAccesoCaja(id);
    const pdf = await pdfCierreCaja(id, usuario.nombre);
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="cierre-caja-${id.slice(-6)}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
