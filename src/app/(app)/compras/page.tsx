import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { ModuloProximamente } from "@/components/layout/modulo-proximamente";
import { requirePaginaPermiso } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Compras" };

export default async function Page() {
  await requirePaginaPermiso(Modulo.COMPRAS, "ver");
  return <ModuloProximamente titulo="Compras" descripcion="Mercadería recibida de proveedores" />;
}
