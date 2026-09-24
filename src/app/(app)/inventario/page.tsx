import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { ModuloProximamente } from "@/components/layout/modulo-proximamente";
import { requirePaginaPermiso } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Inventario" };

export default async function Page() {
  await requirePaginaPermiso(Modulo.INVENTARIO, "ver");
  return (
    <ModuloProximamente titulo="Inventario" descripcion="Stock por producto, sabor y depósito" />
  );
}
