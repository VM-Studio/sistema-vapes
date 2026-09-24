import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { ModuloProximamente } from "@/components/layout/modulo-proximamente";
import { requirePaginaPermiso } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Configuración" };

export default async function Page() {
  await requirePaginaPermiso(Modulo.CONFIGURACION, "ver");
  return (
    <ModuloProximamente titulo="Configuración" descripcion="Datos del negocio y preferencias" />
  );
}
