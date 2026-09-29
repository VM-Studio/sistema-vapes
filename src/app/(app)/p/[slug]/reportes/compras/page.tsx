import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { cn, formatearFecha, formatearFechaHora } from "@/lib/utils";
import { requirePaginaPanelOwner } from "@/server/auth/permissions";
import { filtrosComprasSchema, rangoReporte } from "@/server/reportes/filtros";
import { historialPrecios, type CambioPrecioHistorial } from "@/server/services/proveedor.service";
import {
  comprasPorProveedor,
  opcionesFiltros,
  productosConPrecioProveedor,
  type CompraPorProveedor,
} from "@/server/services/reporte.service";

import { BarraFiltros, FilaMobile } from "../_componentes/barra-filtros";
import { CabeceraReporte } from "../_componentes/cabecera-reporte";
import { FiltroPeriodo } from "../_componentes/filtro-periodo";
import { FiltroSelect } from "../_componentes/filtro-select";
import { GraficoBarras } from "../_componentes/grafico-barras";
import { GraficoLineas } from "../_componentes/grafico-lineas";
import { paramsPlanos } from "../_componentes/params";

export const metadata: Metadata = { title: "Compras y precios de proveedores" };

const precio = (p: string, m: "ARS" | "USD") =>
  m === "USD" ? `US$ ${Number(p).toLocaleString("es-AR")}` : formatearPesos(p);

/** Reporte 7 (SOLO dueños): compras recibidas por proveedor y evolución de precios de proveedor. */
export default async function ReporteComprasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePaginaPanelOwner();
  const plano = await paramsPlanos(searchParams);
  const r = rangoReporte(plano);
  const f = filtrosComprasSchema.parse(plano);
  const [porProv, historial, o, productos] = await Promise.all([
    comprasPorProveedor(ctx, r, f),
    historialPrecios(ctx, {
      proveedorId: f.proveedorId,
      productoId: f.productoId,
      desde: r.inicio,
      hasta: r.fin,
    }),
    opcionesFiltros(ctx),
    productosConPrecioProveedor(ctx),
  ]);

  // Evolución (un producto elegido, precios en pesos): una línea por proveedor.
  const enPesos = f.productoId ? [...historial].reverse().filter((h) => h.moneda === "ARS") : [];
  const series = [
    ...new Map(
      enPesos.map((h) => [h.proveedorId, { clave: h.proveedorId, nombre: h.proveedor }]),
    ).values(),
  ];
  const puntos = enPesos.map((h) => ({
    fecha: formatearFecha(h.fecha),
    [h.proveedorId]: Number(h.precio),
  }));

  return (
    <>
      <CabeceraReporte
        slug={ctx.panel.slug}
        clave="compras"
        titulo="Compras y precios de proveedores"
        subtitulo={r.etiqueta}
        params={plano}
      />
      <BarraFiltros>
        <FiltroPeriodo periodo={r.periodo} desde={r.desde} hasta={r.hasta} />
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <FiltroSelect
            param="proveedorId"
            valor={f.proveedorId}
            etiqueta="Proveedor"
            todos="Todos los proveedores"
            opciones={o.proveedores.map((p) => ({
              value: p.id,
              label: `${p.nombre} (${p.nombreTienda})`,
            }))}
          />
          <FiltroSelect
            param="productoId"
            valor={f.productoId}
            etiqueta="Producto"
            todos="Todos los productos"
            opciones={productos.map((p) => ({ value: p.id, label: p.nombre }))}
          />
        </div>
      </BarraFiltros>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="Compras recibidas por proveedor">
          <GraficoBarras
            horizontal
            moneda
            nombre="Total"
            datos={porProv.map((x) => ({ etiqueta: x.proveedor, valor: Number(x.total) }))}
          />
        </SectionCard>
        <SectionCard title="Detalle por proveedor">
          <DataTable
            caption="Compras por proveedor"
            rows={porProv}
            getRowKey={(x) => x.proveedorId ?? "sin"}
            empty={<EmptyState title="No hay compras recibidas en el período" />}
            columns={[
              {
                key: "p",
                header: "Proveedor",
                cell: (x: CompraPorProveedor) => (
                  <span className="font-medium">
                    {x.proveedor}
                    <span className="text-muted block text-xs font-normal">{x.tienda}</span>
                  </span>
                ),
              },
              {
                key: "c",
                header: "Compras",
                className: "text-right tabular-nums",
                cell: (x) => formatearNumero(x.compras),
              },
              {
                key: "u",
                header: "Unidades",
                className: "text-right tabular-nums",
                cell: (x) => formatearNumero(x.unidades),
              },
              {
                key: "t",
                header: "Total",
                className: "text-right tabular-nums font-medium",
                cell: (x) => formatearPesos(x.total),
              },
              {
                key: "f",
                header: "Última",
                cell: (x) => <span className="text-muted">{formatearFecha(x.ultima)}</span>,
              },
            ]}
            renderMobile={(x) => (
              <FilaMobile className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="font-semibold">{x.proveedor}</span>
                  <span className="text-muted text-small block">
                    {x.compras} compras · {x.unidades} u.
                  </span>
                </span>
                <span className="font-semibold tabular-nums">{formatearPesos(x.total)}</span>
              </FilaMobile>
            )}
          />
        </SectionCard>
      </div>

      <SectionCard
        className="mt-4"
        title="Evolución de precios de proveedor"
        description={
          f.productoId
            ? "Una línea por proveedor (precios en pesos)."
            : "Elegí un producto en los filtros para ver la evolución en un gráfico."
        }
        contentClassName="flex flex-col gap-4"
      >
        {f.productoId && <GraficoLineas datos={puntos} series={series} />}
        <DataTable
          caption="Historial de precios"
          rows={historial}
          getRowKey={(h) => h.id}
          empty={<EmptyState title="No hubo cambios de precio en el período" />}
          columns={[
            {
              key: "fecha",
              header: "Fecha",
              cell: (h: CambioPrecioHistorial) => (
                <span className="text-muted">{formatearFechaHora(h.fecha)}</span>
              ),
            },
            { key: "producto", header: "Producto", cell: (h) => h.nombreCompleto },
            { key: "prov", header: "Proveedor", cell: (h) => `${h.proveedor} (${h.tienda})` },
            {
              key: "ant",
              header: "Anterior",
              className: "text-right tabular-nums",
              cell: (h) =>
                h.anterior === null ? (
                  <Badge>Alta</Badge>
                ) : (
                  precio(h.anterior, h.monedaAnterior ?? "ARS")
                ),
            },
            {
              key: "nuevo",
              header: "Nuevo",
              className: "text-right tabular-nums font-medium",
              cell: (h) => precio(h.precio, h.moneda),
            },
            {
              key: "var",
              header: "Variación",
              className: "text-right tabular-nums",
              cell: (h) =>
                h.variacionPct === null ? (
                  "—"
                ) : (
                  <span
                    className={cn(
                      h.variacionPct > 0 ? "text-danger" : h.variacionPct < 0 ? "text-success" : "",
                    )}
                  >
                    {h.variacionPct > 0 ? "+" : ""}
                    {h.variacionPct.toLocaleString("es-AR")} %
                  </span>
                ),
            },
          ]}
          renderMobile={(h) => (
            <FilaMobile data-testid="fila-historial">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{h.nombreCompleto}</span>
                <span className="font-semibold tabular-nums">{precio(h.precio, h.moneda)}</span>
              </div>
              <p className="text-muted text-small mt-1">
                {h.proveedor} · {formatearFechaHora(h.fecha)} ·{" "}
                {h.anterior === null
                  ? "Alta"
                  : `antes ${precio(h.anterior, h.monedaAnterior ?? "ARS")}`}
                {h.variacionPct !== null
                  ? ` (${h.variacionPct > 0 ? "+" : ""}${h.variacionPct.toLocaleString("es-AR")} %)`
                  : ""}
              </p>
            </FilaMobile>
          )}
        />
      </SectionCard>
    </>
  );
}
