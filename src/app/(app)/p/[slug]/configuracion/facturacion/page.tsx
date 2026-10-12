import type { Metadata } from "next";

import { TabsNav } from "@/components/ui/tabs-nav";
import { requirePaginaPanelOwner } from "@/server/auth/permissions";
import { obtenerConfigFacturacion } from "@/server/services/configuracion.service";

import { tabsAjustesPanel } from "../secciones";
import { ConfigFacturacionForm } from "./config-facturacion-form";

export const metadata: Metadata = { title: "Facturación" };

export default async function ConfigFacturacionPage() {
  const ctx = await requirePaginaPanelOwner();
  const config = await obtenerConfigFacturacion(ctx);
  return (
    <>
      <TabsNav
        items={tabsAjustesPanel(ctx.panel.slug, "/configuracion/facturacion")}
        className="mb-6"
        ariaLabel="Ajustes del panel"
      />
      <ConfigFacturacionForm config={config} />
    </>
  );
}
