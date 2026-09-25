import type { Metadata } from "next";

import { TabsNav } from "@/components/ui/tabs-nav";
import { requirePaginaOwner } from "@/server/auth/permissions";
import { obtenerConfigVentas } from "@/server/services/configuracion.service";

import { tabsConfiguracion } from "../secciones";
import { ConfigVentasForm } from "./config-ventas-form";

export const metadata: Metadata = { title: "Ventas y comprobante" };

export default async function ConfigVentasPage() {
  await requirePaginaOwner();
  return (
    <>
      <TabsNav
        items={tabsConfiguracion("/configuracion/ventas")}
        className="mb-4"
        ariaLabel="Configuración"
      />
      <ConfigVentasForm config={await obtenerConfigVentas()} />
    </>
  );
}
