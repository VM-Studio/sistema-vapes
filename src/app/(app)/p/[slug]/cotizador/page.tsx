import { EstadoCotizacion, Modulo, TipoCotizacion } from "@prisma/client";
import {
  Calculator,
  ChevronRight,
  PackageOpen,
  Plus,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { TabsNav } from "@/components/ui/tabs-nav";
import { esFechaISO } from "@/lib/fechas";
import { formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { esOwner, puede } from "@/lib/permisos";
import { cn, formatearFecha, formatearFechaHora } from "@/lib/utils";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { listar } from "@/server/services/cotizacion.service";
import { vendedoresDelPanel } from "@/server/services/venta.service";

import { AccionesFila } from "./acciones-fila";
import { esConvertible, ESTADO_COTIZACION_UI, ETIQUETA_TIPO_COTIZACION } from "./estado-cotizacion";
import { FiltrosCotizaciones } from "./filtros-cotizaciones";

export const metadata: Metadata = { title: "Cotizador" };

type SP = Record<string, string | string[] | undefined>;
type Fila = Awaited<ReturnType<typeof listar>>["cotizaciones"][number];

function CardCotizar({
  href,
  icono: Icono,
  titulo,
  descripcion,
}: {
  href: string;
  icono: LucideIcon;
  titulo: string;
  descripcion: string;
}) {
  return (
    <Link
      href={href}
      className="border-border bg-surface shadow-card hover:border-primary hover:bg-primary-soft group flex min-h-28 items-center gap-4 rounded-2xl border p-5 transition-colors"
    >
      <span className="bg-primary-soft text-primary flex size-14 shrink-0 items-center justify-center rounded-2xl">
        <Icono className="size-7" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-semibold">{titulo}</span>
        <span className="text-muted block text-sm">{descripcion}</span>
      </span>
      <ChevronRight className="text-muted size-5 shrink-0" strokeWidth={1.75} aria-hidden />
    </Link>
  );
}

export default async function CotizadorPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.COTIZADOR, "ver");
  const { slug } = ctx.panel;
  const plano = Object.fromEntries(
    Object.entries(await searchParams).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const tipo = Object.values(TipoCotizacion).includes(plano.tipo as TipoCotizacion)
    ? (plano.tipo as TipoCotizacion)
    : undefined;
  const estado = Object.values(EstadoCotizacion).includes(plano.estado as EstadoCotizacion)
    ? (plano.estado as EstadoCotizacion)
    : undefined;
  const page = Math.max(1, Number(plano.page) || 1);
  const puedeCrear = puede(ctx.usuario, ctx.panelId, Modulo.COTIZADOR, "crear");
  const puedeVender = puede(ctx.usuario, ctx.panelId, Modulo.VENTAS, "crear");

  const [r, vendedores] = await Promise.all([
    listar(ctx, {
      tipo,
      estado,
      vendedorId: plano.vendedorId || undefined,
      clienteId: plano.clienteId || undefined,
      desde: esFechaISO(plano.desde) ? plano.desde : undefined,
      hasta: esFechaISO(plano.hasta) ? plano.hasta : undefined,
      q: plano.q?.trim() || undefined,
      page,
    }),
    vendedoresDelPanel(ctx),
  ]);

  const base = rutaPanel(slug, "/cotizador");
  const conFiltros = Object.entries(plano).some(([k, v]) => k !== "page" && v !== "");
  const tab = (t: TipoCotizacion | null) => {
    const p = new URLSearchParams(plano);
    p.delete("page");
    if (t) p.set("tipo", t);
    else p.delete("tipo");
    return p.size ? `${base}?${p}` : base;
  };
  const href = (c: Fila) => rutaPanel(slug, `/cotizador/${c.id}`);
  const estadoBadge = (c: Fila) => (
    <Badge variant={ESTADO_COTIZACION_UI[c.estado].variante}>
      {ESTADO_COTIZACION_UI[c.estado].label}
    </Badge>
  );
  const acciones = (c: Fila) => (
    <AccionesFila
      id={c.id}
      codigo={c.codigo}
      puedeCrear={puedeCrear}
      convertible={esConvertible(c.estado)}
      puedeVender={puedeVender}
    />
  );

  return (
    <>
      <PageHeader
        title="Cotizador"
        subtitle="Presupuestos por unidad y por mayor para compartir por WhatsApp o PDF."
        actions={
          esOwner(ctx.usuario) && (
            <Link
              href={rutaPanel(slug, "/cotizador/configuracion")}
              className={buttonVariants({ variant: "secondary" })}
            >
              <Settings2 strokeWidth={1.75} /> Configuración
            </Link>
          )
        }
      />
      {puedeCrear && (
        <div className="mb-6 grid gap-3 md:grid-cols-2">
          <CardCotizar
            href={rutaPanel(slug, "/cotizador/unitaria/nueva")}
            icono={Calculator}
            titulo="Cotizar por unidad"
            descripcion="Precio de lista por sabor, para el cliente de mostrador."
          />
          <CardCotizar
            href={rutaPanel(slug, "/cotizador/mayorista/nueva")}
            icono={PackageOpen}
            titulo="Cotizar por mayor"
            descripcion="Precios por escalón de cantidad, para revendedores."
          />
        </div>
      )}

      <TabsNav
        className="mb-4"
        ariaLabel="Tipo de cotización"
        items={[
          { href: tab(null), label: "Todas", activo: !tipo },
          { href: tab("UNITARIA"), label: "Unitarias", activo: tipo === "UNITARIA" },
          { href: tab("MAYORISTA"), label: "Mayoristas", activo: tipo === "MAYORISTA" },
        ]}
      />
      <FiltrosCotizaciones params={plano} vendedores={vendedores} />

      <DataTable
        caption="Cotizaciones"
        rows={r.cotizaciones}
        getRowKey={(c) => c.id}
        empty={
          conFiltros ? (
            <EmptyState
              icon={Calculator}
              title="No hay cotizaciones con esos filtros"
              action={
                <Link href={base} className={buttonVariants({ variant: "secondary" })}>
                  Limpiar filtros
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={Calculator}
              title="Todavía no hay cotizaciones"
              description="Armá un presupuesto por unidad o por mayor y compartilo por WhatsApp o PDF."
              action={
                puedeCrear ? (
                  <Link
                    href={rutaPanel(slug, "/cotizador/unitaria/nueva")}
                    className={buttonVariants()}
                  >
                    <Plus strokeWidth={1.75} /> Crear la primera cotización
                  </Link>
                ) : null
              }
            />
          )
        }
        columns={[
          {
            key: "codigo",
            header: "Código",
            cell: (c) => (
              <Link
                href={href(c)}
                className="text-primary font-semibold tabular-nums hover:underline"
              >
                {c.codigo}
              </Link>
            ),
          },
          {
            key: "fecha",
            header: "Fecha",
            cell: (c) => <span className="text-muted">{formatearFechaHora(c.fecha)}</span>,
          },
          { key: "tipo", header: "Tipo", cell: (c) => ETIQUETA_TIPO_COTIZACION[c.tipo] },
          {
            key: "cliente",
            header: "Cliente",
            cell: (c) => c.clienteNombre ?? <span className="text-muted">Sin cliente</span>,
          },
          { key: "vendedor", header: "Vendedor", cell: (c) => c.vendedor },
          {
            key: "total",
            header: "Total",
            className: "text-right tabular-nums font-medium",
            cell: (c) => formatearPesos(c.total),
          },
          { key: "estado", header: "Estado", cell: estadoBadge },
          {
            key: "validez",
            header: "Válida hasta",
            cell: (c) => <span className="text-muted">{formatearFecha(c.validaHasta)}</span>,
          },
          { key: "acciones", header: <span className="sr-only">Acciones</span>, cell: acciones },
        ]}
        renderMobile={(c) => (
          <div className="border-border bg-surface shadow-card flex flex-col gap-2 rounded-2xl border p-4">
            <Link href={href(c)} className="flex flex-col gap-2">
              <span className="flex items-center justify-between gap-2">
                <span className="text-primary font-semibold tabular-nums">{c.codigo}</span>
                <span className="font-semibold tabular-nums">{formatearPesos(c.total)}</span>
              </span>
              <span className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  {c.clienteNombre ?? "Sin cliente"}
                  <span className="text-muted"> · {ETIQUETA_TIPO_COTIZACION[c.tipo]}</span>
                </span>
                {estadoBadge(c)}
              </span>
              <span className={cn("text-muted text-xs")}>
                {formatearFecha(c.fecha)} · {c.vendedor} · válida hasta{" "}
                {formatearFecha(c.validaHasta)}
              </span>
            </Link>
            <div className="border-border border-t pt-1">{acciones(c)}</div>
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
