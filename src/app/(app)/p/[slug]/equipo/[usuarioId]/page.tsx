import { ArrowLeft, FileSpreadsheet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { KpisVendedor, Tarjeta } from "@/components/analitica/secciones";
import { SelectorPeriodo } from "@/components/analitica/selector-periodo";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Pagination } from "@/components/ui/pagination";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { formatearFechaHora } from "@/lib/utils";
import { ETIQUETA_MEDIO_PAGO, ETIQUETA_TIPO_VENTA } from "@/lib/ventas-ui";
import { requirePaginaPanelOwner } from "@/server/auth/permissions";
import {
  describirPeriodo,
  diaDe,
  periodoDesdeParams,
  queryPeriodo,
  rendimientoVendedorDetalle,
  type VentaDeVendedor,
} from "@/server/services/analitica.service";

export const metadata: Metadata = { title: "Rendimiento del vendedor" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Detalle de un vendedor (solo dueños): KPIs vs. el período anterior y todas sus ventas. */
export default async function EquipoVendedorPage({
  params,
  searchParams,
}: {
  params: Promise<{ usuarioId: string }>;
  searchParams: SearchParams;
}) {
  const ctx = await requirePaginaPanelOwner();
  const [{ usuarioId }, sp] = await Promise.all([params, searchParams]);
  const periodo = periodoDesdeParams(sp);
  const desc = describirPeriodo(periodo);
  const page = Number(typeof sp.page === "string" ? sp.page : 1) || 1;
  const d = await rendimientoVendedorDetalle(ctx, usuarioId, periodo, page);
  const ruta = (r: string) => rutaPanel(ctx.panel.slug, r);
  const qs = queryPeriodo(sp);

  const columnas = [
    {
      key: "codigo",
      header: "ID",
      cell: (v: VentaDeVendedor) => (
        <Link
          href={ruta(`/ventas/${v.id}`)}
          className="text-primary font-medium tabular-nums hover:underline"
        >
          {v.codigo}
        </Link>
      ),
    },
    { key: "fecha", header: "Fecha", cell: (v: VentaDeVendedor) => formatearFechaHora(v.fecha) },
    {
      key: "tipo",
      header: "Tipo",
      cell: (v: VentaDeVendedor) => (
        <Badge variant={v.tipo === "MAYORISTA" ? "primary" : "neutral"}>
          {ETIQUETA_TIPO_VENTA[v.tipo]}
        </Badge>
      ),
    },
    { key: "cliente", header: "Cliente", cell: (v: VentaDeVendedor) => v.cliente },
    {
      key: "medio",
      header: "Medio",
      cell: (v: VentaDeVendedor) => ETIQUETA_MEDIO_PAGO[v.medioPago],
      ocultarEnMobile: true,
    },
    {
      key: "unidades",
      header: "Unidades",
      className: "text-right tabular-nums",
      cell: (v: VentaDeVendedor) => formatearNumero(v.unidades),
    },
    {
      key: "total",
      header: "Total",
      className: "text-right font-semibold tabular-nums",
      cell: (v: VentaDeVendedor) => formatearPesos(v.total),
    },
  ];

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <Link
        href={`${rutaPanel(ctx.panel.slug)}${qs}`}
        className="text-muted hover:text-foreground flex min-h-11 w-fit items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden /> Inicio
      </Link>
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl leading-tight font-semibold tracking-tight md:text-3xl">
            {d.usuario.nombre}
          </h1>
          <Badge variant={d.usuario.rol === "OWNER" ? "primary" : "neutral"}>
            {d.usuario.rol === "OWNER" ? "Dueño" : "Empleado"}
          </Badge>
        </div>
        <SelectorPeriodo
          modo={periodo.modo}
          desde={diaDe(periodo.desde)}
          hasta={diaDe(periodo.hasta)}
          preset={typeof sp.preset === "string" ? sp.preset : null}
          etiqueta={desc.etiqueta}
          comparacion={desc.comparacion}
        />
      </header>

      <KpisVendedor r={d} periodo={periodo} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {[
          [
            "Unitarias",
            `${formatearNumero(d.actual.unitarias.cantidad)} · ${formatearPesos(d.actual.unitarias.total)}`,
          ],
          [
            "Mayoristas",
            `${formatearNumero(d.actual.mayoristas.cantidad)} · ${formatearPesos(d.actual.mayoristas.total)}`,
          ],
          [
            "Cotizaciones",
            `${d.actual.cotizaciones.convertidas}/${d.actual.cotizaciones.creadas} convertidas${
              d.actual.cotizaciones.tasaPct !== null
                ? ` (${d.actual.cotizaciones.tasaPct.toLocaleString("es-AR")} %)`
                : ""
            }`,
          ],
          ["Devoluciones registradas", formatearNumero(d.actual.devoluciones)],
        ].map(([label, valor]) => (
          <div key={label} className="border-border bg-surface rounded-2xl border p-4">
            <p className="text-muted text-xs">{label}</p>
            <p className="font-medium tabular-nums">{valor}</p>
          </div>
        ))}
      </div>

      <Tarjeta
        titulo="Ventas del período"
        subtitulo={`${formatearNumero(d.ventas.total)} ${d.ventas.total === 1 ? "venta" : "ventas"}`}
        accion={
          <a
            href={`/api/p/${ctx.panel.slug}/equipo/${d.usuario.id}/exportar${qs}`}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
            download
          >
            <FileSpreadsheet strokeWidth={1.75} aria-hidden /> Exportar Excel
          </a>
        }
      >
        <DataTable
          columns={columnas}
          rows={d.ventas.filas}
          getRowKey={(v) => v.id}
          caption="Ventas del vendedor"
          empty={<p className="text-muted py-8 text-center text-sm">Sin ventas en el período.</p>}
        />
        <Pagination
          className="mt-4"
          page={d.ventas.page}
          pageSize={d.ventas.pageSize}
          total={d.ventas.total}
          pathname={ruta(`/equipo/${d.usuario.id}`)}
          params={sp}
        />
      </Tarjeta>
    </div>
  );
}
