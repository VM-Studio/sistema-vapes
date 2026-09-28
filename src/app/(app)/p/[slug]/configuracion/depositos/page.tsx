import type { Metadata } from "next";

import { TabsNav } from "@/components/ui/tabs-nav";
import { requirePaginaPanelOwner } from "@/server/auth/permissions";
import { listarDepositos } from "@/server/services/deposito.service";

import { tabsAjustesPanel } from "../secciones";
import { DepositosView } from "./depositos-view";

export const metadata: Metadata = { title: "Depósitos" };

export default async function DepositosPage() {
  const ctx = await requirePaginaPanelOwner();
  const depositos = await listarDepositos(ctx);
  return (
    <>
      <TabsNav
        items={tabsAjustesPanel(ctx.panel.slug, "/configuracion/depositos")}
        className="mb-4"
        ariaLabel="Ajustes del panel"
      />
      <DepositosView depositos={depositos} />
    </>
  );
}
