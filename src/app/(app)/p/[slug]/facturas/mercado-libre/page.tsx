import { Modulo } from "@prisma/client";
import { CheckCircle2, Clock, ShoppingBag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { StatCard } from "@/components/ui/stat-card";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { puede } from "@/lib/permisos";
import { cn, formatearFecha } from "@/lib/utils";
import { ESTADO_FACTURA_ML_UI, listarVentasMLSchema } from "@/lib/validations/factura";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { listarVentasML, type VentaMLListada } from "@/server/services/factura-ml.service";

import { TabsFacturas } from "../tabs-facturas";
import { AccionesVentaML } from "./acciones-venta-ml";
import { FiltrosVentasML } from "./filtros-ventas-ml";

export const metadata: Metadata = { title: "Ventas Mercado Libre · Facturas" };

type SP = Record<string, string | string[] | undefined>;

const ventas = (n: number) => `${formatearNumero(n)} ${n === 1 ? "venta" : "ventas"}`;

/**
 * Facturas → Ventas Mercado Libre (FACTURAS "ver"; cargar con "editar"): cada
 * venta confirmada cobrada por Mercado Libre aparece sola al registrarse, con
 * su factura pendiente o cargada (la factura se emite en ARCA, por fuera).
 * Tarjetas: total $ y cantidad de cargadas y de pendientes del período.
 */
export default async function VentasMLPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.FACTURAS, "ver");
  const { slug } = ctx.panel;
  const plano = Object.fromEntries(
    Object.entries(await searchParams).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const filtros = listarVentasMLSchema.parse(plano);
  const r = await listarVentasML(ctx, filtros);
  const puedeEditar = puede(ctx.usuario, ctx.panelId, Modulo.FACTURAS, "editar");
  const conFiltros = Object.entries(plano).some(([k, v]) => k !== "page" && v !== "");
  const urlArchivo = (v: VentaMLListada) =>
    v.factura?.tieneArchivo ? `/api/p/${slug}/facturas/mercado-libre/${v.id}/archivo` : null;
  const estado = (v: VentaMLListada) => (
    <Badge variant={ESTADO_FACTURA_ML_UI[v.estado].variante} data-testid="estado-factura-ml">
      {ESTADO_FACTURA_ML_UI[v.estado].label}
    </Badge>
  );
  const factura = (v: VentaMLListada) => {
    if (!v.factura) return <span className="text-muted">—</span>;
    const url = urlArchivo(v);
    return (
      <span className="flex flex-col text-sm">
        <span>
          {formatearFecha(v.factura.fecha)}
          <span className="text-muted"> · {v.factura.usuario}</span>
        </span>
        {url ? (
          <span className="flex gap-3">
            <a
              href={url}
              target="_blank"
              rel="noopener"
              className="text-foreground font-medium hover:underline"
              data-testid="ver-archivo-ml"
            >
              Ver archivo
            </a>
            <a href={`${url}?descargar=1`} className="text-muted hover:underline" download>
              Descargar
            </a>
          </span>
        ) : (
          <span className="text-muted text-xs">Sin archivo</span>
        )}
      </span>
    );
  };
  const acciones = (v: VentaMLListada) => (
    <AccionesVentaML venta={v} puedeEditar={puedeEditar} urlArchivo={urlArchivo(v)} />
  );

  return (
    <>
      <PageHeader
        title="Facturas"
        subtitle="Las ventas cobradas por Mercado Libre: marcá cuándo se cargó su factura en ARCA."
      />
      <TabsFacturas
        slug={slug}
        activa="mercado-libre"
        pendientesML={r.totales.pendientes.cantidad}
      />
      <section
        aria-label="Totales de ventas Mercado Libre"
        className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 md:gap-4"
      >
        <div data-testid="tarjeta-ml-cargadas">
          <StatCard
            label="Con factura cargada"
            value={formatearPesos(r.totales.cargadas.total)}
            hint={ventas(r.totales.cargadas.cantidad)}
            icono={CheckCircle2}
            acento="oliva"
          />
        </div>
        <div data-testid="tarjeta-ml-pendientes">
          <StatCard
            label="Factura pendiente de cargar"
            value={formatearPesos(r.totales.pendientes.total)}
            hint={ventas(r.totales.pendientes.cantidad)}
            icono={Clock}
            acento="naranja"
          />
        </div>
      </section>
      <FiltrosVentasML params={plano} />
      <DataTable
        caption="Ventas Mercado Libre"
        rows={r.ventas}
        getRowKey={(v) => v.id}
        empty={
          <EmptyState
            icon={ShoppingBag}
            title={
              conFiltros
                ? "No hay ventas Mercado Libre con esos filtros"
                : "Todavía no hay ventas cobradas por Mercado Libre"
            }
            description={
              conFiltros
                ? undefined
                : "Cada venta que se cobra por Mercado Libre aparece acá sola, con su factura pendiente de cargar."
            }
          />
        }
        columns={[
          {
            key: "codigo",
            header: "Venta",
            cell: (v) => (
              <Link
                href={rutaPanel(slug, `/ventas/${v.id}`)}
                className="text-foreground font-mono font-semibold hover:underline"
                data-testid="fila-venta-ml"
              >
                {v.codigo}
              </Link>
            ),
          },
          {
            key: "fecha",
            header: "Fecha",
            cell: (v) => <span className="text-muted">{formatearFecha(v.fecha)}</span>,
          },
          {
            key: "cliente",
            header: "Cliente",
            cell: (v) => <span className="font-medium">{v.cliente.nombre}</span>,
          },
          {
            key: "total",
            header: "Total",
            className: "text-right tabular-nums",
            cell: (v) => <span className="font-semibold">{formatearPesos(v.total)}</span>,
          },
          { key: "estado", header: "Factura", cell: estado },
          { key: "factura", header: "Cargada", cell: factura },
          { key: "acciones", header: <span className="sr-only">Acciones</span>, cell: acciones },
        ]}
        renderMobile={(v) => (
          <div
            className={cn(cardVariants(), "flex flex-col gap-2 p-4")}
            data-testid="tarjeta-venta-ml"
          >
            <div className="flex items-center justify-between gap-2">
              <Link
                href={rutaPanel(slug, `/ventas/${v.id}`)}
                className="font-mono font-semibold hover:underline"
              >
                {v.codigo}
              </Link>
              <span className="font-semibold tabular-nums">{formatearPesos(v.total)}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{v.cliente.nombre}</span>
              {estado(v)}
            </div>
            <p className="text-muted text-small">
              {formatearFecha(v.fecha)}
              {v.factura &&
                ` · Factura del ${formatearFecha(v.factura.fecha)}${v.factura.tieneArchivo ? "" : " (sin archivo)"}`}
            </p>
            {v.factura?.tieneArchivo && <div>{factura(v)}</div>}
            {acciones(v)}
          </div>
        )}
      />
      <Pagination
        className="mt-4"
        page={r.page}
        pageSize={r.pageSize}
        total={r.total}
        pathname={rutaPanel(slug, "/facturas/mercado-libre")}
        params={plano}
      />
    </>
  );
}
