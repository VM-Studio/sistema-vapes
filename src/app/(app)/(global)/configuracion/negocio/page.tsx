import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { TabsNav } from "@/components/ui/tabs-nav";
import { requirePaginaOwner } from "@/server/auth/permissions";
import { nombreNegocio, tieneIconoPropio } from "@/server/services/identidad.service";

import { tabsConfiguracion } from "../secciones";
import { IconoForm } from "./icono-form";
import { NombreForm } from "./nombre-form";

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
        subtitle="Nombre e ícono de la app instalada (valen para todos los sistemas)."
      />
      <div className="flex flex-col gap-4">
        <NombreForm nombre={nombre} />
        <IconoForm propio={propio} />
      </div>
    </>
  );
}
