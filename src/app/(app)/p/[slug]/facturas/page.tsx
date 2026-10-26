import { Modulo } from "@prisma/client";
import { CheckCircle2, Clock, ShoppingBag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { ChipLink, ChipRow } from "@/components/ui/chip";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { hrefCon, Pagination } from "@/components/ui/pagination";
import { StatCard } from "@/components/ui/stat-card";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { puede } from "@/lib/permisos";
import { cn, formatearFecha } from "@/lib/utils";
import {
  ESTADO_FACTURA_ML_UI,
  listarVentasMLSchema,
  type EstadoFacturaML,
} from "@/lib/validations/factura";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { listarVentasML, type VentaMLListada } from "@/server/services/factura-ml.service";

import { AccionesVentaML } from "./mercado-libre/acciones-venta-ml";
import { FiltrosVentasML } from "./mercado-libre/filtros-ventas-ml";

export const metadata: Metadata = { title: "Facturas" };

type SP = Record<string, string | string[] | undefined>;

const ventas = (n: number) => `${formatearNumero(n)} ${n === 1 ? "venta" : "ventas"}`;

/**
 * Facturas (FACTURAS "ver"; cargar con "editar"): desde A4 el módulo muestra
 * SOLO las ventas cobradas por Mercado Libre. Cada venta confirmada por ML
 * aparece sola al registrarse, con su factura pendiente o cargada (la factura
 * se emite en ARCA, por fuera). Tarjetas: CANTIDAD de ventas con factura
 * cargada y pendientes del período (el monto va chico); cada tarjeta filtra el
 * listado (?estado=, en la URL). Las facturas del sistema (/facturas/{id},
 * /facturas/comunes) siguen andando, sin acceso desde la navegación.
 */
export default async function FacturasPage({ searchParams }: { searchParams: Promise<SP> }) {
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
  // Tarjetas y chips: filtran por estado (en la URL); tocar la activa vuelve a «Todas».
  // Son links comunes (recargan la página): con next/link la navegación a esta
  // misma página con otro ?estado= a veces quedaba colgada en producción.
  const base = rutaPanel(slug, "/facturas");
  const filtrar = (estado: EstadoFacturaML | null) => hrefCon(base, plano, { estado, page: null });
  const acciones = (v: VentaMLListada) => (
    <AccionesVentaML venta={v} puedeEditar={puedeEditar} urlArchivo={urlArchivo(v)} />
  );

  return (
    <>
      <PageHeader
        title="Facturas"
        subtitle="Las ventas cobradas por Mercado Libre: marcá cuándo se cargó su factura en ARCA."
      />
      <section
        aria-label="Totales de ventas Mercado Libre"
        className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 md:gap-4"
      >
        <div data-testid="tarjeta-ml-cargadas" data-activa={filtros.estado === "CARGADA"}>
          <StatCard
            label="Con factura cargada"
            value={formatearNumero(r.totales.cargadas.cantidad)}
            hint={`${ventas(r.totales.cargadas.cantidad)} · ${formatearPesos(r.totales.cargadas.total)}`}
            icono={CheckCircle2}
            acento="oliva"
            href={filtrar(filtros.estado === "CARGADA" ? null : "CARGADA")}
            activo={filtros.estado === "CARGADA"}
            recargar
          />
        </div>
        <div data-testid="tarjeta-ml-pendientes" data-activa={filtros.estado === "PENDIENTE"}>
          <StatCard
            label="Pendientes de factura"
            value={formatearNumero(r.totales.pendientes.cantidad)}
            hint={`${ventas(r.totales.pendientes.cantidad)} · ${formatearPesos(r.totales.pendientes.total)}`}
            icono={Clock}
            acento="naranja"
            href={filtrar(filtros.estado === "PENDIENTE" ? null : "PENDIENTE")}
            activo={filtros.estado === "PENDIENTE"}
            recargar
          />
        </div>
      </section>
      <ChipRow ariaLabel="Estado de la factura" className="mb-3">
        <ChipLink href={filtrar(null)} activo={!filtros.estado} pestana recargar>
          Todas
        </ChipLink>
        <ChipLink href={filtrar("CARGADA")} activo={filtros.estado === "CARGADA"} pestana recargar>
          Con factura cargada
        </ChipLink>
        <ChipLink
          href={filtrar("PENDIENTE")}
          activo={filtros.estado === "PENDIENTE"}
          pestana
          recargar
        >
          Pendientes de factura
        </ChipLink>
      </ChipRow>
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
        pathname={base}
        params={plano}
      />
    </>
  );
}
