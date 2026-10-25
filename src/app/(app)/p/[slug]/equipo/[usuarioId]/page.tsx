import { FileSpreadsheet, Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { GraficoComparativo } from "@/components/analitica/grafico-comparativo";
import { TarifasDialog } from "@/components/ganancia/acciones-ganancia";
import { AvisoLiquidaciones } from "@/components/ganancia/aviso-liquidaciones";
import { SeccionGanancia } from "@/components/ganancia/seccion-ganancia";
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
import { esMes } from "@/lib/ganancia-vendedor";
import { rutaPanel } from "@/lib/paneles";
import { cn, formatearFechaHora } from "@/lib/utils";
import { ETIQUETA_TIPO_VENTA, etiquetaMedioPrincipal } from "@/lib/ventas-ui";
import { requirePaginaPanelOwner } from "@/server/auth/permissions";
import {
  describirPeriodo,
  diaDe,
  periodoDesdeParams,
  queryPeriodo,
  ventasDeVendedor,
  type VentaDeVendedor,
} from "@/server/services/analitica.service";

import {
  gananciaDelMes,
  liquidacionesDe,
  mesActual,
  obtenerTarifas,
} from "@/server/services/ganancia-vendedor.service";

import { EstadoPagoBadge } from "../../ventas/_componentes/medio-pago";

export const metadata: Metadata = { title: "Ventas del vendedor" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** "Nuevo" al lado del cliente que se dio de alta con esa venta. */
function ClienteVenta({ v }: { v: VentaDeVendedor }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 truncate">{v.cliente}</span>
      {v.clienteNuevo && (
        <Badge variant="success" title="Se dio de alta con esta venta">
          Nuevo
        </Badge>
      )}
    </span>
  );
}

/** Estado de pago: "Debe $ X" si quedó saldo, "Pagada" si no. */
function PagoVenta({ v }: { v: VentaDeVendedor }) {
  if (v.estadoPago === "PAGADA" || !(Number(v.saldoPendiente) > 0))
    return <span className="text-muted text-small">Pagada</span>;
  return <EstadoPagoBadge estado={v.estadoPago} saldo={v.saldoPendiente} />;
}

/**
 * "Ventas de {vendedor}" (solo dueños): la única pantalla del rendimiento de
 * una persona. Se llega desde Equipo y desde la tarjeta de Reportes
 * (`?origen=reportes`, que solo cambia la miga de pan): ventas, vapes
 * vendidos, clientes nuevos y total contra el período anterior, el facturado
 * por día y todas sus ventas (cada una abre su detalle).
 */
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
  const mes = esMes(sp.mes) ? sp.mes : mesActual();
  const [d, ganancia, historial, tarifas] = await Promise.all([
    ventasDeVendedor(ctx, usuarioId, periodo, page),
    gananciaDelMes(ctx, usuarioId, mes),
    liquidacionesDe(ctx, usuarioId),
    obtenerTarifas(ctx, usuarioId),
  ]);
  const pendientes = historial.filter((l) => l.estado === "PENDIENTE" && l.mes !== mes);
  const ruta = (r: string) => rutaPanel(ctx.panel.slug, r);
  const qs = queryPeriodo(sp);
  const desdeReportes = sp.origen === "reportes";
  const etiquetaUnidades = ctx.panel.etiquetaUnidades;
  /** Cambia el mes de la ganancia sin perder el período ni la página. */
  const hrefMes = (m: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "mes") q.set(k, v);
    q.set("mes", m);
    return `${ruta(`/equipo/${usuarioId}`)}?${q.toString()}#ganancia`;
  };

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
    { key: "cliente", header: "Cliente", cell: (v: VentaDeVendedor) => <ClienteVenta v={v} /> },
    {
      key: "tipo",
      header: "Tipo",
      cell: (v: VentaDeVendedor) => (
        <Badge variant={v.tipo === "MAYORISTA" ? "primary" : "neutral"}>
          {ETIQUETA_TIPO_VENTA[v.tipo]}
        </Badge>
      ),
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
    {
      key: "pago",
      header: "Pago",
      cell: (v: VentaDeVendedor) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-muted text-small">{etiquetaMedioPrincipal(v.medioPago)}</span>
          <PagoVenta v={v} />
        </span>
      ),
      ocultarEnMobile: true,
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
    ["Ventas a clientes nuevos", formatearNumero(d.actual.ventasAClientesNuevos)],
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
          items={
            desdeReportes
              ? [
                  { label: "Inicio", href: rutaPanel(ctx.panel.slug) },
                  { label: "Reportes", href: ruta("/reportes") },
                  { label: `Ventas de ${d.usuario.nombre}` },
                ]
              : [
                  { label: "Inicio", href: `${rutaPanel(ctx.panel.slug)}${qs}` },
                  { label: "Equipo", href: `${ruta("/equipo")}${qs}` },
                  { label: d.usuario.nombre },
                ]
          }
        />
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar nombre={d.usuario.nombre} className="size-12 text-sm" />
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="text-h1 truncate font-semibold">Ventas de {d.usuario.nombre}</h1>
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

      <AvisoLiquidaciones pendientes={pendientes} slug={ctx.panel.slug} />

      <KpisVendedor r={d} periodo={periodo} etiquetaUnidades={etiquetaUnidades} sinComision />

      <section className="bg-card rounded-card flex flex-col gap-4 p-5 md:p-6">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-h3 font-semibold">{desc.tituloGrafico}</h2>
          <p className="text-muted text-small">Facturado por {d.usuario.nombre}</p>
        </div>
        <GraficoComparativo datos={d.serie} />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section
          className={cn(
            "bg-card rounded-card p-5 md:p-6",
            d.comision ? "lg:col-span-2" : "lg:col-span-3",
          )}
        >
          <h2 className="text-h3 font-semibold">Detalle del período</h2>
          <dl className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
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

      {ganancia ? (
        <div className="mt-4">
          <SeccionGanancia
            g={ganancia}
            historial={historial}
            slug={ctx.panel.slug}
            dueno
            tarifasVigentes={tarifas}
            hrefMes={hrefMes}
            rutaVenta={(id) => ruta(`/ventas/${id}`)}
          />
        </div>
      ) : (
        d.usuario.rol !== "OWNER" && (
          <section className="bg-card rounded-card mt-4 flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between md:p-6">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-h3 font-semibold">Ganancia por vape</h2>
              <p className="text-muted text-small">
                {d.usuario.nombre} no tiene ganancia por vape en este panel.
              </p>
            </div>
            <TarifasDialog usuarioId={d.usuario.id} nombre={d.usuario.nombre} tarifas={null} />
          </section>
        )
      )}

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
          caption={`Ventas de ${d.usuario.nombre}`}
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
                <span className="min-w-0 text-sm">
                  <ClienteVenta v={v} />
                </span>
                <Badge variant={v.tipo === "MAYORISTA" ? "primary" : "neutral"}>
                  {ETIQUETA_TIPO_VENTA[v.tipo]}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-subtle text-small tabular-nums">
                  {formatearFechaHora(v.fecha)} · {etiquetaMedioPrincipal(v.medioPago)} ·{" "}
                  {formatearNumero(v.unidades)} u.
                </p>
                <PagoVenta v={v} />
              </div>
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
