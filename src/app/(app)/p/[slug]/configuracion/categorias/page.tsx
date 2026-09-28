import type { Metadata } from "next";

import { TabsNav } from "@/components/ui/tabs-nav";
import { requirePaginaPanelOwner } from "@/server/auth/permissions";
import { listarCategorias } from "@/server/services/categoria.service";

import { ClasificacionView } from "../clasificacion-view";
import { tabsAjustesPanel } from "../secciones";

export const metadata: Metadata = { title: "Categorías" };

export default async function Page() {
  const ctx = await requirePaginaPanelOwner();
  const filas = await listarCategorias(ctx);
  return (
    <>
      <TabsNav
        items={tabsAjustesPanel(ctx.panel.slug, "/configuracion/categorias")}
        className="mb-4"
        ariaLabel="Ajustes del panel"
      />
      <ClasificacionView tipo="categoria" filas={filas} />
    </>
  );
}
