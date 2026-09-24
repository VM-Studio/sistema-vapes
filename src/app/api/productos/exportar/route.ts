import { Modulo } from "@prisma/client";

import { listarProductosSchema } from "@/lib/validations/producto";
import { paramsComoObjeto, respuestaCSV } from "@/server/auth/descarga";
import { mapearErrorHttp } from "@/server/auth/http";
import { requirePermiso } from "@/server/auth/permissions";
import { listarDepositosActivos } from "@/server/services/deposito.service";
import { exportarProductosCSV } from "@/server/services/producto.service";

export const runtime = "nodejs";

/** GET /api/productos/exportar?<mismos filtros del listado> */
export async function GET(req: Request) {
  try {
    await requirePermiso(Modulo.PRODUCTOS, "ver");
    const filtros = listarProductosSchema.parse(paramsComoObjeto(req.url));
    return respuestaCSV(
      await exportarProductosCSV(filtros, await listarDepositosActivos()),
      "productos",
    );
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
