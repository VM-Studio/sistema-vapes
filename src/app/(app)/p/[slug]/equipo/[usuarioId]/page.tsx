import { FileSpreadsheet, Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ETIQUETA_ANTERIOR, KpisVendedor } from "@/components/analitica/secciones";
import { SelectorPeriodo } from "@/components/analitica/selector-periodo";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { StatCard } from "@/components/ui/stat-card";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { cn, formatearFechaHora } from "@/lib/utils";
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
          className="text-foreground font-mono font-semibold hover:underline"
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
      className: "text-right",
      cell: (v: VentaDeVendedor) => formatearNumero(v.unidades),
    },
    {
      key: "total",
      header: "Total",
      className: "text-right font-semibold",
      cell: (v: VentaDeVendedor) => formatearPesos(v.total),
    },
  ];

  const detalle: [string, string][] = [
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
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="mb-2 flex flex-col gap-4 md:mb-4">
        <Breadcrumb
          items={[
            { label: "Inicio", href: `${rutaPanel(ctx.panel.slug)}${qs}` },
            { label: "Equipo", href: `${ruta("/equipo")}${qs}` },
            { label: d.usuario.nombre },
          ]}
        />
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar nombre={d.usuario.nombre} className="size-12 text-sm" />
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="text-h1 truncate font-semibold">{d.usuario.nombre}</h1>
              <div>
                <Badge variant={d.usuario.rol === "OWNER" ? "primary" : "neutral"}>
                  {d.usuario.rol === "OWNER" ? "Dueño" : "Empleado"}
                </Badge>
              </div>
            </div>
          </div>
          <SelectorPeriodo
            alinear="fin"
            modo={periodo.modo}
            desde={diaDe(periodo.desde)}
            hasta={diaDe(periodo.hasta)}
            preset={typeof sp.preset === "string" ? sp.preset : null}
            etiqueta={desc.etiqueta}
            comparacion={desc.comparacion}
          />
        </div>
      </header>

      <KpisVendedor r={d} periodo={periodo} sinComision />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section
          className={cn(
            "bg-card rounded-card p-5 md:p-6",
            d.comision ? "lg:col-span-2" : "lg:col-span-3",
          )}
        >
          <h2 className="text-h3 font-semibold">Detalle del período</h2>
          <dl className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            {detalle.map(([label, valor]) => (
              <div
                key={label}
                className="bg-surface rounded-inner flex min-w-0 flex-col gap-0.5 p-3"
              >
                <dt className="text-muted text-small">{label}</dt>
                <dd className="text-sm font-semibold break-words tabular-nums">{valor}</dd>
              </div>
            ))}
          </dl>
        </section>
        {d.comision && (
          <StatCard
            label="Comisión estimada"
            value={formatearPesos(d.comision.actual)}
            anterior={formatearPesos(d.comision.anterior)}
            etiquetaAnterior={ETIQUETA_ANTERIOR[periodo.modo]}
            deltaPct={d.comision.deltaPct}
            hint="Orientativa: se calcula con los porcentajes de comisión del usuario sobre sus ventas unitarias y mayoristas."
            className="md:p-6"
          />
        )}
      </div>

      <section className="mt-4 flex flex-col gap-4" aria-labelledby="ventas-periodo">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id="ventas-periodo" className="text-h2 font-semibold">
              Ventas del período
            </h2>
            <p className="text-muted text-small">{`${formatearNumero(d.ventas.total)} ${d.ventas.total === 1 ? "venta" : "ventas"}`}</p>
          </div>
          <a
            href={`/api/p/${ctx.panel.slug}/equipo/${d.usuario.id}/exportar${qs}`}
            className={buttonVariants({ variant: "secondary" })}
            download
          >
            <FileSpreadsheet strokeWidth={1.75} aria-hidden /> Exportar Excel
          </a>
        </div>
        <DataTable
          columns={columnas}
          rows={d.ventas.filas}
          getRowKey={(v) => v.id}
          caption="Ventas del vendedor"
          renderMobile={(v) => (
            <Link
              href={ruta(`/ventas/${v.id}`)}
              className={cn(cardVariants({ variant: "clickable" }), "flex flex-col gap-2 p-4")}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-sm font-semibold">{v.codigo}</span>
                <span className="font-semibold tabular-nums">{formatearPesos(v.total)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm">{v.cliente}</span>
                <Badge variant={v.tipo === "MAYORISTA" ? "primary" : "neutral"}>
                  {ETIQUETA_TIPO_VENTA[v.tipo]}
                </Badge>
              </div>
              <p className="text-subtle text-small tabular-nums">
                {formatearFechaHora(v.fecha)} · {ETIQUETA_MEDIO_PAGO[v.medioPago]} ·{" "}
                {formatearNumero(v.unidades)} u.
              </p>
            </Link>
          )}
          empty={<EmptyState icon={Receipt} title="Todavía no hay ventas en este período" />}
        />
        <Pagination
          page={d.ventas.page}
          pageSize={d.ventas.pageSize}
          total={d.ventas.total}
          pathname={ruta(`/equipo/${d.usuario.id}`)}
          params={sp}
        />
      </section>
    </div>
  );
}
