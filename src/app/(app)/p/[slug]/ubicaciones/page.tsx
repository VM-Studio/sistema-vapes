import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { esOwner } from "@/lib/permisos";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { datosUbicaciones } from "@/server/services/ubicacion.service";

import { UbicacionesView } from "./ubicaciones-view";

export const metadata: Metadata = { title: "Ubicaciones de productos" };

/**
 * Ubicaciones de productos: dónde está guardado cada modelo en el galpón.
 * Los dueños arman los lugares y asignan los modelos; el perfil de escaneo
 * (Charly) lo ve para saber en qué estante buscar (Modulo.ESCANEO "ver").
 */
export default async function UbicacionesPage() {
  const ctx = await requirePaginaPanel(Modulo.ESCANEO, "ver");
  const datos = await datosUbicaciones(ctx);
  return <UbicacionesView datos={datos} editable={esOwner(ctx.usuario)} />;
}
