import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { ModuloProximamente } from "@/components/layout/modulo-proximamente";
import { requirePaginaPermisoAlguno } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Escanear" };

export default async function Page() {
  // Escanear sirve tanto para vender como para inventario.
  await requirePaginaPermisoAlguno([Modulo.VENTAS, Modulo.INVENTARIO], "ver");
  return (
    <ModuloProximamente
      titulo="Escanear"
      descripcion="Buscá productos con la pistola lectora o la cámara"
    />
  );
}
