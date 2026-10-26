import { EstadoFactura, Modulo, TipoFactura } from "@prisma/client";
import { FileSpreadsheet, ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { StatCard } from "@/components/ui/stat-card";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { esOwner } from "@/lib/permisos";
import { cn, formatearFecha } from "@/lib/utils";
import {
  ESTADO_FACTURA_UI,
  listarFacturasSchema,
  TIPO_FACTURA_CORTO,
  TIPO_FACTURA_LABEL,
} from "@/lib/validations/factura";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { obtenerConfigFacturacion } from "@/server/services/configuracion.service";
import { listar, type FacturaListada } from "@/server/services/factura.service";

import { FiltrosFacturas } from "../filtros-facturas";

export const metadata: Metadata = { title: "Facturas del sistema" };

type SP = Record<string, string | string[] | undefined>;

/**
 * Facturas del sistema (FACTURAS "ver"): número, tipo, fecha, cliente, venta
 * vinculada, total, estado y PDF; filtros y Excel del período. Desde A4 el
 * módulo Facturas muestra solo las ventas Mercado Libre: esta lista queda sin
 * acceso desde la navegación (ni «Nueva factura»), para consultar las
 * facturas que ya se hubieran emitido (/facturas/{id} sigue andando).
 */
export default async function FacturasComunesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.FACTURAS, "ver");
  const { slug } = ctx.panel;
  const plano = Object.fromEntries(
    Object.entries(await searchParams).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const filtros = listarFacturasSchema.parse(plano);
  const [r, config] = await Promise.all([listar(ctx, filtros), obtenerConfigFacturacion(ctx)]);
  const href = (f: FacturaListada) => rutaPanel(slug, `/facturas/${f.id}`);
  const exportar = `/api/p/${slug}/facturas/exportar?${new URLSearchParams(
    Object.entries(plano).filter(([k]) => k !== "page"),
  ).toString()}`;
  const pdf = (f: FacturaListada) => `/api/p/${slug}/facturas/${f.id}/pdf`;
  const estado = (f: FacturaListada) => (
    <Badge variant={ESTADO_FACTURA_UI[f.estado].variante}>
      {ESTADO_FACTURA_UI[f.estado].label}
    </Badge>
  );
  const conFiltros = Object.entries(plano).some(([k, v]) => k !== "page" && v !== "");

  return (
    <>
      <PageHeader
        title="Facturas del sistema"
        subtitle="Las facturas que se emitieron por fuera (con su número fiscal) y los comprobantes internos."
        actions={
          <a href={exportar} className={buttonVariants({ variant: "secondary" })} download>
            <FileSpreadsheet strokeWidth={1.75} /> Exportar Excel
          </a>
        }
      />
      {!config.habilitada && (
        <p className="bg-card text-muted rounded-card mb-4 px-4 py-3 text-sm">
          La facturación está desactivada en este panel.
          {esOwner(ctx.usuario) && (
            <>
              {" "}
              <Link
                href={rutaPanel(slug, "/configuracion/facturacion")}
                className="text-foreground font-medium underline-offset-4 hover:underline"
              >
                Activala en Ajustes → Facturación
              </Link>
              .
            </>
          )}
        </p>
      )}
      <section aria-label="Totales" className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        <StatCard label="Facturas emitidas" value={formatearNumero(r.resumen.cantidad)} />
        <StatCard label="Total facturado" value={formatearPesos(r.resumen.total)} />
        <StatCard label="IVA discriminado" value={formatearPesos(r.resumen.iva)} />
      </section>
      <FiltrosFacturas
        params={plano}
        tipos={Object.values(TipoFactura).map((t) => ({ value: t, label: TIPO_FACTURA_LABEL[t] }))}
        estados={Object.values(EstadoFactura).map((e) => ({
          value: e,
          label: ESTADO_FACTURA_UI[e].label,
        }))}
      />
      <DataTable
        caption="Facturas"
        rows={r.facturas}
        getRowKey={(f) => f.id}
        empty={
          <EmptyState
            icon={ReceiptText}
            title={conFiltros ? "No hay facturas con esos filtros" : "Todavía no hay facturas"}
            description={
              conFiltros ? undefined : "Las facturas emitidas desde el sistema aparecen acá."
            }
          />
        }
        columns={[
          {
            key: "codigo",
            header: "Número",
            cell: (f) => (
              <Link
                href={href(f)}
                className="text-foreground font-mono font-semibold hover:underline"
                data-testid="fila-factura"
              >
                {f.codigo}
              </Link>
            ),
          },
          {
            key: "tipo",
            header: "Tipo",
            cell: (f) => (
              <span className="flex flex-col">
                <span>{TIPO_FACTURA_LABEL[f.tipo]}</span>
                {f.numeroExterno && (
                  <span className="text-muted font-mono text-xs">{f.numeroExterno}</span>
                )}
              </span>
            ),
          },
          {
            key: "fecha",
            header: "Fecha",
            cell: (f) => <span className="text-muted">{formatearFecha(f.fecha)}</span>,
          },
          {
            key: "cliente",
            header: "Cliente",
            cell: (f) => <span className="font-medium">{f.razonSocial ?? f.cliente.nombre}</span>,
          },
          {
            key: "venta",
            header: "Venta",
            cell: (f) =>
              f.venta ? (
                <Link
                  href={rutaPanel(slug, `/ventas/${f.venta.id}`)}
                  className="font-mono hover:underline"
                >
                  {f.venta.codigo}
                </Link>
              ) : (
                <span className="text-muted">Suelta</span>
              ),
          },
          {
            key: "total",
            header: "Total",
            className: "text-right tabular-nums",
            cell: (f) => (
              <span
                className={cn("font-semibold", f.estado === "ANULADA" && "text-muted line-through")}
              >
                {formatearPesos(f.total)}
              </span>
            ),
          },
          { key: "estado", header: "Estado", cell: estado },
          {
            key: "pdf",
            header: "PDF",
            cell: (f) => (
              <a
                href={pdf(f)}
                target="_blank"
                rel="noopener"
                className="text-foreground text-sm font-medium hover:underline"
              >
                {f.tieneArchivo ? "Ver factura" : "Ver comprobante"}
              </a>
            ),
          },
        ]}
        renderMobile={(f) => (
          <Link
            href={href(f)}
            className={cn(cardVariants({ variant: "clickable" }), "flex flex-col gap-2 p-4")}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono font-semibold">
                {f.codigo} · {TIPO_FACTURA_CORTO[f.tipo]}
              </span>
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  f.estado === "ANULADA" && "text-muted line-through",
                )}
              >
                {formatearPesos(f.total)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{f.razonSocial ?? f.cliente.nombre}</span>
              {estado(f)}
            </div>
            <p className="text-muted text-small">
              {formatearFecha(f.fecha)} · {f.venta ? `Venta ${f.venta.codigo}` : "Suelta"}
            </p>
          </Link>
        )}
      />
      <Pagination
        className="mt-4"
        page={r.page}
        pageSize={r.pageSize}
        total={r.total}
        pathname={rutaPanel(slug, "/facturas/comunes")}
        params={plano}
      />
    </>
  );
}
