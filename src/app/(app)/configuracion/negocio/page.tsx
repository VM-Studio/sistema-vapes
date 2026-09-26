import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { TabsNav } from "@/components/ui/tabs-nav";
import { requirePaginaOwner } from "@/server/auth/permissions";
import { nombreNegocio, tieneIconoPropio } from "@/server/services/identidad.service";

import { tabsConfiguracion } from "../secciones";
import { IconoForm } from "./icono-form";

export const metadata: Metadata = { title: "Negocio y app" };

export default async function ConfigNegocioPage() {
  await requirePaginaOwner();
  const [nombre, propio] = await Promise.all([nombreNegocio(), tieneIconoPropio()]);
  return (
    <>
      <TabsNav
        items={tabsConfiguracion("/configuracion/negocio")}
        className="mb-4"
        ariaLabel="Configuración"
      />
      <PageHeader
        title="Negocio y app"
        subtitle={`La app instalada se llama «${nombre}» (se cambia en Ventas y comprobante). Acá va su ícono.`}
      />
      <IconoForm propio={propio} />
    </>
  );
}
