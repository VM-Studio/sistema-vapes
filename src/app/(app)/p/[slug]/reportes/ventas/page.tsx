import { EstadoVenta, Modulo, TipoVenta } from "@prisma/client";
import { Receipt } from "lucide-react";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { esOwner } from "@/lib/permisos";
import { formatearFechaHora } from "@/lib/utils";
import {
  ESTADO_VENTA_UI,
  ETIQUETA_MEDIO_PAGO,
  etiquetaMedioPrincipal,
  ETIQUETA_TIPO_VENTA,
  MEDIOS_PAGO,
} from "@/lib/ventas-ui";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { filtrosVentasSchema, rangoReporte } from "@/server/reportes/filtros";
import {
  opcionesFiltros,
  reporteVentas,
  type VentaReporte,
} from "@/server/services/reporte.service";

import { BarraFiltros, FilaMobile, GrillaKpis } from "../_componentes/barra-filtros";
import { CabeceraReporte } from "../_componentes/cabecera-reporte";
import { FiltroPeriodo } from "../_componentes/filtro-periodo";
import { FiltroSelect } from "../_componentes/filtro-select";
import { GraficoBarras } from "../_componentes/grafico-barras";
import { paramsPlanos } from "../_componentes/params";

export const metadata: Metadata = { title: "Reporte de ventas" };

type SP = Promise<Record<string, string | string[] | undefined>>;

/** Reporte 4: detalle de ventas con filtros (la ganancia, solo dueños). */
export default async function ReporteVentasPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requirePaginaPanel(Modulo.REPORTES, "ver");
  const plano = await paramsPlanos(searchParams);
  const owner = esOwner(ctx.usuario);
  const r = rangoReporte(plano);
  const f = filtrosVentasSchema.parse(plano);
  const [v, o] = await Promise.all([reporteVentas(ctx, r, f, { owner }), opcionesFiltros(ctx)]);
  const PATH = rutaPanel(ctx.panel.slug, "/reportes/ventas");

  return (
    <>
      <CabeceraReporte
        slug={ctx.panel.slug}
        clave="ventas"
        titulo="Ventas"
        subtitulo={r.etiqueta}
        params={plano}
      />
      <BarraFiltros>
        <FiltroPeriodo periodo={r.periodo} desde={r.desde} hasta={r.hasta} />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
          <FiltroSelect
            param="vendedorId"
            valor={f.vendedorId}
            etiqueta="Vendedor"
            todos="Todos los vendedores"
            opciones={o.vendedores.map((x) => ({ value: x.id, label: x.nombre }))}
          />
          <FiltroSelect
            param="depositoId"
            valor={f.depositoId}
            etiqueta="Galpón"
            todos="Todos los galpones"
            opciones={o.depositos.map((x) => ({ value: x.id, label: x.nombre }))}
          />
          <FiltroSelect
            param="medioPago"
            valor={f.medioPago}
            etiqueta="Medio de pago"
            todos="Todos los medios"
            opciones={MEDIOS_PAGO.map((m) => ({ value: m, label: ETIQUETA_MEDIO_PAGO[m] }))}
          />
          <FiltroSelect
            param="tipo"
            valor={f.tipo}
            etiqueta="Tipo"
            todos="Unitarias y mayoristas"
            opciones={Object.values(TipoVenta).map((t) => ({
              value: t,
              label: ETIQUETA_TIPO_VENTA[t],
            }))}
          />
          <FiltroSelect
            param="estado"
            valor={f.estado}
            etiqueta="Estado"
            todos="Confirmadas"
            opciones={[
              { value: EstadoVenta.ANULADA, label: "Anuladas" },
              { value: "TODAS", label: "Todas" },
            ]}
          />
        </div>
      </BarraFiltros>

      <GrillaKpis>
        <StatCard label="Ventas" value={formatearNumero(v.resumen.ventas)} />
        <StatCard label={ctx.panel.etiquetaUnidades} value={formatearNumero(v.resumen.unidades)} />
        <StatCard label="Total" value={formatearPesos(v.resumen.total)} />
        {v.resumen.ganancia !== null && (
          <StatCard label="Ganancia bruta" value={formatearPesos(v.resumen.ganancia)} />
        )}
      </GrillaKpis>

      <SectionCard title="Total por día" className="mb-4 md:mb-6">
        <GraficoBarras
          moneda
          nombre="Total"
          datos={v.porDia.map((d) => ({
            etiqueta: `${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}`,
            valor: Number(d.total),
          }))}
        />
      </SectionCard>

      <SectionCard
        title="Detalle de ventas"
        description={`${formatearNumero(v.cantidad)} ${v.cantidad === 1 ? "venta" : "ventas"} en el período`}
      >
        <DataTable
          caption="Ventas del período"
          rows={v.filas}
          getRowKey={(x) => x.id}
          empty={<EmptyState icon={Receipt} title="No hay ventas con estos filtros" />}
          columns={[
            {
              key: "codigo",
              header: "ID",
              cell: (x: VentaReporte) => (
                <span className="font-mono font-semibold whitespace-nowrap">{x.codigo}</span>
              ),
            },
            {
              key: "fecha",
              header: "Fecha",
              cell: (x) => (
                <span className="text-muted whitespace-nowrap">{formatearFechaHora(x.fecha)}</span>
              ),
            },
            { key: "cliente", header: "Cliente", cell: (x) => x.cliente },
            { key: "vendedor", header: "Vendedor", cell: (x) => x.vendedor },
            { key: "deposito", header: "Galpón", cell: (x) => x.deposito },
            { key: "tipo", header: "Tipo", cell: (x) => ETIQUETA_TIPO_VENTA[x.tipo] },
            { key: "medio", header: "Medio", cell: (x) => etiquetaMedioPrincipal(x.medioPago) },
            {
              key: "estado",
              header: "Estado",
              cell: (x) => (
                <Badge variant={ESTADO_VENTA_UI[x.estado].variante}>
                  {ESTADO_VENTA_UI[x.estado].label}
                </Badge>
              ),
            },
            {
              key: "unidades",
              header: "Unid.",
              className: "text-right tabular-nums",
              cell: (x) => x.unidades,
            },
            {
              key: "total",
              header: "Total",
              className: "text-right tabular-nums font-medium",
              cell: (x) => formatearPesos(x.total),
            },
            ...(owner
              ? [
                  {
                    key: "ganancia",
                    header: "Ganancia",
                    className: "text-right tabular-nums",
                    cell: (x: VentaReporte) => formatearPesos(x.ganancia),
                  },
                ]
              : []),
          ]}
          renderMobile={(x) => (
            <FilaMobile>
              <div className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 flex-col">
                  <span className="font-mono text-sm font-semibold">{x.codigo}</span>
                  <span className="truncate font-medium">{x.cliente}</span>
                </span>
                <span className="font-semibold tabular-nums">{formatearPesos(x.total)}</span>
              </div>
              <p className="text-muted text-small mt-1">
                {formatearFechaHora(x.fecha)} · {x.vendedor} · {x.deposito} · {x.unidades} u. ·{" "}
                {etiquetaMedioPrincipal(x.medioPago)}
                {x.estado === "ANULADA" ? " · Anulada" : ""}
              </p>
            </FilaMobile>
          )}
        />
        <Pagination
          className="mt-4"
          page={v.page}
          pageSize={v.pageSize}
          total={v.cantidad}
          pathname={PATH}
          params={plano}
        />
      </SectionCard>
    </>
  );
}
