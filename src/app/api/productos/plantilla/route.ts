import { Modulo } from "@prisma/client";

import { respuestaCSV } from "@/server/auth/descarga";
import { mapearErrorHttp } from "@/server/auth/http";
import { requirePermiso } from "@/server/auth/permissions";
import { plantillaCSV } from "@/server/services/producto.service";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requirePermiso(Modulo.PRODUCTOS, "crear");
    return respuestaCSV(plantillaCSV(), "plantilla-productos");
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
