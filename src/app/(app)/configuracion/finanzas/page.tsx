import type { Metadata } from "next";

import { TabsNav } from "@/components/ui/tabs-nav";
import { requirePaginaOwner } from "@/server/auth/permissions";
import { obtenerConfigFinanzas } from "@/server/services/configuracion.service";

import { tabsConfiguracion } from "../secciones";
import { ConfigFinanzasForm } from "./config-finanzas-form";

export const metadata: Metadata = { title: "Caja y reportes" };

export default async function ConfigFinanzasPage() {
  await requirePaginaOwner();
  return (
    <>
      <TabsNav
        items={tabsConfiguracion("/configuracion/finanzas")}
        className="mb-4"
        ariaLabel="Configuración"
      />
      <ConfigFinanzasForm config={await obtenerConfigFinanzas()} />
    </>
  );
}
