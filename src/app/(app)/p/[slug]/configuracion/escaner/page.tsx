import type { Metadata } from "next";

import { TabsNav } from "@/components/ui/tabs-nav";
import { requirePaginaPanelOwner } from "@/server/auth/permissions";
import { obtenerConfigEscaner } from "@/server/services/configuracion.service";

import { tabsAjustesPanel } from "../secciones";
import { EscanerView } from "./escaner-view";

export const metadata: Metadata = { title: "Escáner" };

export default async function EscanerPage() {
  const ctx = await requirePaginaPanelOwner();
  return (
    <>
      <TabsNav
        items={tabsAjustesPanel(ctx.panel.slug, "/configuracion/escaner")}
        className="mb-6"
        ariaLabel="Ajustes del panel"
      />
      <EscanerView config={await obtenerConfigEscaner(ctx)} />
    </>
  );
}
