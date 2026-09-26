import { mapearErrorHttp } from "@/server/auth/http";
import { requireOwner } from "@/server/auth/permissions";
import { streamExportarTodo } from "@/server/reportes/exportar-todo";
import { obtenerConfigVentas } from "@/server/services/configuracion.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET /api/exportar-todo — todos los datos del negocio en un .xlsx (solo dueños). */
export async function GET() {
  try {
    const usuario = await requireOwner();
    const { nombreNegocio } = await obtenerConfigVentas();
    const fecha = new Date().toISOString().slice(0, 10);
    return new Response(streamExportarTodo({ negocio: nombreNegocio, usuario: usuario.nombre }), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="datos-negocio-${fecha}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return mapearErrorHttp(e);
  }
}
