import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { ModuloProximamente } from "@/components/layout/modulo-proximamente";
import { requirePaginaPermiso } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Movimientos" };

export default async function Page() {
  await requirePaginaPermiso(Modulo.MOVIMIENTOS, "ver");
  return (
    <ModuloProximamente
      titulo="Movimientos"
      descripcion="Ingresos, ajustes y transferencias de stock"
    />
  );
}
