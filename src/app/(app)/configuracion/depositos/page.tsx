import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { TabsNav } from "@/components/ui/tabs-nav";
import { requirePaginaPermiso } from "@/server/auth/permissions";
import { listarDepositos } from "@/server/services/deposito.service";

import { tabsConfiguracion } from "../secciones";
import { DepositosView } from "./depositos-view";

export const metadata: Metadata = { title: "Depósitos" };

export default async function DepositosPage() {
  await requirePaginaPermiso(Modulo.CONFIGURACION, "ver");
  const depositos = await listarDepositos();
  return (
    <>
      <TabsNav
        items={tabsConfiguracion("/configuracion/depositos")}
        className="mb-4"
        ariaLabel="Configuración"
      />
      <DepositosView depositos={depositos} />
    </>
  );
}
