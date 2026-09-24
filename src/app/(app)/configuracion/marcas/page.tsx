import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { TabsNav } from "@/components/ui/tabs-nav";
import { requirePaginaPermiso } from "@/server/auth/permissions";
import { listarMarcas } from "@/server/services/marca.service";

import { ClasificacionView } from "../clasificacion-view";
import { tabsConfiguracion } from "../secciones";

export const metadata: Metadata = { title: "Marcas" };

export default async function Page() {
  await requirePaginaPermiso(Modulo.CONFIGURACION, "ver");
  const filas = await listarMarcas();
  return (
    <>
      <TabsNav
        items={tabsConfiguracion("/configuracion/marcas")}
        className="mb-4"
        ariaLabel="Configuración"
      />
      <ClasificacionView tipo="marca" filas={filas} />
    </>
  );
}
