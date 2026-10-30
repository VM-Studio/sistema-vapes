import { Modulo } from "@prisma/client";
import { ShoppingBag } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { tieneMercadoLibre } from "@/lib/medios-pago";
import { esOwner } from "@/lib/permisos";
import { saborVisible } from "@/lib/ventas-ui";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { exigirPaginaReporteFacturado } from "@/server/reportes/armar";
import { rangoReporte } from "@/server/reportes/filtros";
import { obtenerConfigVentas } from "@/server/services/configuracion.service";
import { reporteMercadoLibre, type ReporteMercadoLibre } from "@/server/services/reporte.service";

import { BarraFiltros, FilaMobile, GrillaKpis } from "../_componentes/barra-filtros";
import { CabeceraReporte } from "../_componentes/cabecera-reporte";
import { FiltroPeriodo } from "../_componentes/filtro-periodo";
import { GraficoBarras } from "../_componentes/grafico-barras";
import { paramsPlanos } from "../_componentes/params";

export const metadata: Metadata = { title: "Ventas Mercado Libre" };

type Fila = ReporteMercadoLibre["filas"][number];

/**
 * Ventas cobradas por Mercado Libre (medio principal): cuántas, unidades,
 * total y, para dueños, ganancia; por día y por producto y sabor. Solo en
 * paneles que tienen Mercado Libre entre sus medios de pago.
 */
export default async function ReporteMercadoLibrePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePaginaPanel(Modulo.REPORTES, "ver");
  await exigirPaginaReporteFacturado(ctx);
  if (!tieneMercadoLibre(await obtenerConfigVentas(ctx))) notFound();
  const plano = await paramsPlanos(searchParams);
  const owner = esOwner(ctx.usuario);
  const r = rangoReporte(plano);
  const d = await reporteMercadoLibre(ctx, r, { owner });
  return (
    <>
      <CabeceraReporte
        slug={ctx.panel.slug}
        clave="mercado-libre"
        titulo="Ventas Mercado Libre"
        subtitulo={r.etiqueta}
        params={plano}
      />
      <BarraFiltros>
        <FiltroPeriodo periodo={r.periodo} desde={r.desde} hasta={r.hasta} />
      </BarraFiltros>
      <GrillaKpis>
        <StatCard label="Ventas" value={formatearNumero(d.total.ventas)} />
        <StatCard
          label="Unidades"
          value={formatearNumero(d.total.unidades)}
          hint={`${formatearNumero(d.total.unidadesPrecioML)} a precio Mercado Libre`}
        />
        <StatCard label="Total facturado" value={formatearPesos(d.total.facturado)} />
        {d.total.ganancia !== null && (
          <StatCard label="Ganancia bruta" value={formatearPesos(d.total.ganancia)} />
        )}
      </GrillaKpis>
      <SectionCard title="Facturado por día" className="mb-4">
        <GraficoBarras
          moneda
          nombre="Facturado"
          datos={d.porDia.map((x) => ({
            etiqueta: `${x.dia.slice(8, 10)}/${x.dia.slice(5, 7)}`,
            valor: Number(x.facturado),
          }))}
        />
      </SectionCard>
      <SectionCard title="Por producto y sabor">
        <DataTable
          caption="Ventas Mercado Libre por producto y sabor"
          rows={d.filas}
          getRowKey={(x) => `${x.productoId}-${x.sabor}`}
          empty={
            <EmptyState icon={ShoppingBag} title="No hubo ventas por Mercado Libre en el período" />
          }
          columns={[
            {
              key: "p",
              header: "Producto",
              cell: (x: Fila) => <span className="font-medium">{x.producto}</span>,
            },
            { key: "s", header: "Sabor", cell: (x) => saborVisible(x.sabor) ?? "—" },
            {
              key: "u",
              header: "Unidades",
              className: "text-right tabular-nums",
              cell: (x) => formatearNumero(x.unidades),
            },
            {
              key: "f",
              header: "Facturado",
              className: "text-right tabular-nums font-medium",
              cell: (x) => formatearPesos(x.facturado),
            },
            ...(owner
              ? [
                  {
                    key: "g",
                    header: "Ganancia",
                    className: "text-right tabular-nums",
                    cell: (x: Fila) => (x.ganancia !== null ? formatearPesos(x.ganancia) : "—"),
                  },
                ]
              : []),
          ]}
          renderMobile={(x) => (
            <FilaMobile className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{x.producto}</span>
                <span className="text-muted text-small block">
                  {saborVisible(x.sabor) ?? "Sin sabor"} · {formatearNumero(x.unidades)} u.
                  {x.ganancia !== null && ` · ganancia ${formatearPesos(x.ganancia)}`}
                </span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">
                {formatearPesos(x.facturado)}
              </span>
            </FilaMobile>
          )}
        />
      </SectionCard>
    </>
  );
}
