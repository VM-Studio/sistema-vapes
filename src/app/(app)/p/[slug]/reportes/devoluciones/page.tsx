import { Modulo } from "@prisma/client";
import { RotateCcw } from "lucide-react";
import type { Metadata } from "next";

import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { formatearNumero } from "@/lib/format";
import { saborVisible } from "@/lib/ventas-ui";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { filtrosDevolucionesSchema, rangoReporte } from "@/server/reportes/filtros";
import {
  opcionesFiltros,
  reporteDevoluciones,
  type ReporteDevoluciones,
} from "@/server/services/reporte.service";

import { BarraFiltros, FilaMobile, GrillaKpis } from "../_componentes/barra-filtros";
import { CabeceraReporte } from "../_componentes/cabecera-reporte";
import { FiltroPeriodo } from "../_componentes/filtro-periodo";
import { FiltroSelect } from "../_componentes/filtro-select";
import { GraficoBarras } from "../_componentes/grafico-barras";
import { paramsPlanos } from "../_componentes/params";

export const metadata: Metadata = { title: "Devoluciones por garantía" };

type Fila = ReporteDevoluciones["filas"][number];

/** Reporte 9: devoluciones por garantía (registradas) por producto y sabor. */
export default async function ReporteDevolucionesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePaginaPanel(Modulo.REPORTES, "ver");
  const plano = await paramsPlanos(searchParams);
  const r = rangoReporte(plano);
  const f = filtrosDevolucionesSchema.parse(plano);
  const [d, o] = await Promise.all([reporteDevoluciones(ctx, r, f), opcionesFiltros(ctx)]);
  return (
    <>
      <CabeceraReporte
        slug={ctx.panel.slug}
        clave="devoluciones"
        titulo="Devoluciones por garantía"
        subtitulo={r.etiqueta}
        params={plano}
      />
      <BarraFiltros>
        <FiltroPeriodo periodo={r.periodo} desde={r.desde} hasta={r.hasta} />
        <FiltroSelect
          param="depositoId"
          valor={f.depositoId}
          etiqueta="Galpón"
          todos="Todos los galpones"
          opciones={o.depositos.map((x) => ({ value: x.id, label: x.nombre }))}
          className="md:max-w-xs"
        />
      </BarraFiltros>
      <GrillaKpis>
        <StatCard label="Devoluciones" value={formatearNumero(d.total.devoluciones)} />
        <StatCard label="Unidades devueltas" value={formatearNumero(d.total.unidades)} />
      </GrillaKpis>
      <SectionCard title="Unidades por producto" className="mb-4">
        <GraficoBarras
          horizontal
          nombre="Unidades"
          datos={d.porProducto
            .slice(0, 10)
            .map((x) => ({ etiqueta: x.producto, valor: x.unidades }))}
        />
      </SectionCard>
      <SectionCard title="Por producto y sabor">
        <DataTable
          caption="Devoluciones por producto y sabor"
          rows={d.filas}
          getRowKey={(x) => `${x.productoId}-${x.sabor}`}
          empty={<EmptyState icon={RotateCcw} title="No hubo devoluciones en el período" />}
          columns={[
            {
              key: "p",
              header: "Producto",
              cell: (x: Fila) => <span className="font-medium">{x.producto}</span>,
            },
            { key: "s", header: "Sabor", cell: (x) => saborVisible(x.sabor) ?? "—" },
            {
              key: "d",
              header: "Devoluciones",
              className: "text-right tabular-nums",
              cell: (x) => x.devoluciones,
            },
            {
              key: "u",
              header: "Unidades",
              className: "text-right tabular-nums font-medium",
              cell: (x) => x.unidades,
            },
          ]}
          renderMobile={(x) => (
            <FilaMobile className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{x.producto}</span>
                <span className="text-muted text-small block">
                  {saborVisible(x.sabor) ?? "Sin sabor"} · {x.devoluciones} devoluciones
                </span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{x.unidades} u.</span>
            </FilaMobile>
          )}
        />
      </SectionCard>
    </>
  );
}
