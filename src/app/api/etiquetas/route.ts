import { Modulo } from "@prisma/client";

import { etiquetasSchema } from "@/lib/validations/etiquetas";
import { actorDe } from "@/server/auth/actor";
import { esMismoOrigen, mapearErrorHttp, origenInvalido } from "@/server/auth/http";
import { puede, requirePermiso } from "@/server/auth/permissions";
import { generarPdfEtiquetas } from "@/server/services/etiquetas.service";

export const runtime = "nodejs";

/**
 * POST /api/etiquetas { items: [{varianteId, cantidad}], formato, mostrarPrecio } → PDF.
 * Ver productos alcanza para imprimir; a las variantes sin código se les asigna
 * uno interno solo si además puede editar productos (y queda en la auditoría).
 */
export async function POST(req: Request) {
  try {
    if (!esMismoOrigen(req)) return origenInvalido();
    const usuario = await requirePermiso(Modulo.PRODUCTOS, "ver");
    const pedido = etiquetasSchema.parse(await req.json());
    const r = await generarPdfEtiquetas(pedido, await actorDe(usuario), {
      puedeGenerarCodigos: puede(usuario, Modulo.PRODUCTOS, "editar"),
    });
    return new Response(Buffer.from(r.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="etiquetas-${pedido.formato}.pdf"`,
        "Cache-Control": "no-store",
        "X-Etiquetas": String(r.etiquetas),
        "X-Codigos-Generados": String(r.codigosGenerados),
      },
    });
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
