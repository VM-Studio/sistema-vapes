import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { TabsNav } from "@/components/ui/tabs-nav";
import { requirePaginaPermiso } from "@/server/auth/permissions";
import { listarCategorias } from "@/server/services/categoria.service";

import { ClasificacionView } from "../clasificacion-view";
import { tabsConfiguracion } from "../secciones";

export const metadata: Metadata = { title: "Categorías" };

export default async function Page() {
  await requirePaginaPermiso(Modulo.CONFIGURACION, "ver");
  const filas = await listarCategorias();
  return (
    <>
      <TabsNav
        items={tabsConfiguracion("/configuracion/categorias")}
        className="mb-4"
        ariaLabel="Configuración"
      />
      <ClasificacionView tipo="categoria" filas={filas} />
    </>
  );
}
