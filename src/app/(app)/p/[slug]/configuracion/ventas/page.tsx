import type { Metadata } from "next";

import { TabsNav } from "@/components/ui/tabs-nav";
import { requirePaginaPanelOwner } from "@/server/auth/permissions";
import {
  obtenerConfigCatalogo,
  obtenerConfigVentas,
} from "@/server/services/configuracion.service";

import { tabsAjustesPanel } from "../secciones";
import { ConfigVentasForm } from "./config-ventas-form";

export const metadata: Metadata = { title: "Ventas y catálogo" };

export default async function ConfigVentasPage() {
  const ctx = await requirePaginaPanelOwner();
  const [ventas, catalogo] = await Promise.all([
    obtenerConfigVentas(ctx),
    obtenerConfigCatalogo(ctx),
  ]);
  return (
    <>
      <TabsNav
        items={tabsAjustesPanel(ctx.panel.slug, "/configuracion/ventas")}
        className="mb-4"
        ariaLabel="Ajustes del panel"
      />
      <ConfigVentasForm ventas={ventas} catalogo={catalogo} />
    </>
  );
}
