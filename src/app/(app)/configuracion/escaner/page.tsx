import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { TabsNav } from "@/components/ui/tabs-nav";
import { requirePaginaPermiso } from "@/server/auth/permissions";
import { obtenerConfigEscaner } from "@/server/services/configuracion.service";

import { tabsConfiguracion } from "../secciones";
import { EscanerView } from "./escaner-view";

export const metadata: Metadata = { title: "Escáner" };

export default async function EscanerPage() {
  await requirePaginaPermiso(Modulo.CONFIGURACION, "ver");
  return (
    <>
      <TabsNav
        items={tabsConfiguracion("/configuracion/escaner")}
        className="mb-4"
        ariaLabel="Configuración"
      />
      <EscanerView config={await obtenerConfigEscaner()} />
    </>
  );
}
