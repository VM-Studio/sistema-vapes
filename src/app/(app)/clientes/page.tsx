import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { ModuloProximamente } from "@/components/layout/modulo-proximamente";
import { requirePaginaPermiso } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Clientes" };

export default async function Page() {
  await requirePaginaPermiso(Modulo.CLIENTES, "ver");
  return <ModuloProximamente titulo="Clientes" descripcion="Datos y compras de clientes" />;
}
