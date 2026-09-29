import { FileSpreadsheet } from "lucide-react";
import type { Metadata } from "next";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { TabsNav } from "@/components/ui/tabs-nav";
import { requirePaginaOwner } from "@/server/auth/permissions";

import { tabsConfiguracion } from "../secciones";

export const metadata: Metadata = { title: "Exportar todo" };

export default async function ExportarTodoPage() {
  await requirePaginaOwner();
  return (
    <>
      <TabsNav
        items={tabsConfiguracion("/configuracion/exportar-todo")}
        className="mb-4"
        ariaLabel="Configuración"
      />
      <PageHeader
        title="Exportar todos los datos"
        subtitle="Es tu negocio: llevate tus datos cuando quieras, en un Excel que abre cualquier planilla."
      />
      <Card>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p>
            Incluye, de todos los sistemas: productos y sabores (con costos y códigos), stock por
            galpón, todos los movimientos de stock, ventas, devoluciones por garantía, compras y
            cotizaciones con sus ítems, clientes, proveedores y sus precios. Con muchos datos puede
            tardar unos segundos.
          </p>
          <a
            href="/api/exportar-todo"
            download
            className={buttonVariants({ className: "w-full md:w-fit" })}
          >
            <FileSpreadsheet /> Descargar Excel completo
          </a>
        </CardContent>
      </Card>
    </>
  );
}
