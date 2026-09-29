import { FileSpreadsheet } from "lucide-react";
import type { Metadata } from "next";

import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
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
        className="mb-6"
        ariaLabel="Configuración"
      />
      <PageHeader
        title="Exportar todos los datos"
        subtitle="Es tu negocio: llevate tus datos cuando quieras, en un Excel que abre cualquier planilla."
      />
      <SectionCard
        title="Excel completo"
        description="Una hoja por tipo de dato. Con muchos datos puede tardar unos segundos."
        className="max-w-3xl"
        contentClassName="flex flex-col gap-5"
      >
        <p className="text-muted">
          Incluye, de todos los sistemas: productos y sabores (con costos y códigos), stock por
          galpón, todos los movimientos de stock, ventas, devoluciones por garantía, compras y
          cotizaciones con sus ítems, clientes, proveedores y sus precios.
        </p>
        <a
          href="/api/exportar-todo"
          download
          className={buttonVariants({ className: "w-full sm:w-fit sm:self-end" })}
        >
          <FileSpreadsheet strokeWidth={1.75} /> Descargar Excel completo
        </a>
      </SectionCard>
    </>
  );
}
