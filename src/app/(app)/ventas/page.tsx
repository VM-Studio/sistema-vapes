import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { ModuloProximamente } from "@/components/layout/modulo-proximamente";
import { requirePaginaPermiso } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Ventas" };

export default async function Page() {
  await requirePaginaPermiso(Modulo.VENTAS, "ver");
  return <ModuloProximamente titulo="Ventas" descripcion="Registrar y consultar ventas" />;
}
