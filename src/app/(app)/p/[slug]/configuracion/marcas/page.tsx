import type { Metadata } from "next";

import { TabsNav } from "@/components/ui/tabs-nav";
import { requirePaginaPanelOwner } from "@/server/auth/permissions";
import { listarMarcas } from "@/server/services/marca.service";

import { ClasificacionView } from "../clasificacion-view";
import { tabsAjustesPanel } from "../secciones";

export const metadata: Metadata = { title: "Marcas" };

export default async function Page() {
  const ctx = await requirePaginaPanelOwner();
  const filas = await listarMarcas(ctx);
  return (
    <>
      <TabsNav
        items={tabsAjustesPanel(ctx.panel.slug, "/configuracion/marcas")}
        className="mb-4"
        ariaLabel="Ajustes del panel"
      />
      <ClasificacionView tipo="marca" filas={filas} />
    </>
  );
}
