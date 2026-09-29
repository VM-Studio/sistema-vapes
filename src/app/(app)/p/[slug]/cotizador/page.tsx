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
import { cardVariants } from "@/components/ui/card";
import { ChipLink, ChipRow } from "@/components/ui/chip";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { esFechaISO } from "@/lib/fechas";
import { formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { esOwner, puede } from "@/lib/permisos";
import { formatearFecha, formatearFechaHora } from "@/lib/utils";
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
      className={cardVariants({
        variant: "clickable",
        className: "group flex min-h-28 items-center gap-4 p-5 md:p-6",
      })}
    >
      <span className="bg-surface text-foreground rounded-control flex size-12 shrink-0 items-center justify-center">
        <Icono className="size-6" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-h2 font-semibold">{titulo}</span>
        <span className="text-muted text-small">{descripcion}</span>
      </span>
      <ChevronRight
        className="text-subtle group-hover:text-foreground size-5 shrink-0 transition-colors"
        strokeWidth={1.75}
        aria-hidden
      />
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
        <div className="mb-8 grid gap-4 md:grid-cols-2">
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

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-h3 font-semibold">Cotizaciones</h2>
        <span className="text-muted text-small tabular-nums">
          {r.total} {r.total === 1 ? "cotización" : "cotizaciones"}
        </span>
      </div>
      <section aria-label="Filtros" className="bg-card rounded-card mb-4 flex flex-col gap-3 p-4">
        <ChipRow ariaLabel="Tipo de cotización">
          <ChipLink href={tab(null)} activo={!tipo}>
            Todas
          </ChipLink>
          <ChipLink href={tab("UNITARIA")} activo={tipo === "UNITARIA"}>
            Unitarias
          </ChipLink>
          <ChipLink href={tab("MAYORISTA")} activo={tipo === "MAYORISTA"}>
            Mayoristas
          </ChipLink>
        </ChipRow>
        <FiltrosCotizaciones params={plano} vendedores={vendedores} />
      </section>

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
                className="text-foreground font-mono font-semibold whitespace-nowrap hover:underline"
              >
                {c.codigo}
              </Link>
            ),
          },
          {
            key: "fecha",
            header: "Fecha",
            cell: (c) => (
              <span className="text-muted whitespace-nowrap">{formatearFechaHora(c.fecha)}</span>
            ),
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
            className: "text-right tabular-nums font-semibold whitespace-nowrap",
            cell: (c) => formatearPesos(c.total),
          },
          { key: "estado", header: "Estado", cell: estadoBadge },
          {
            key: "validez",
            header: "Válida hasta",
            cell: (c) => (
              <span className="text-muted whitespace-nowrap">{formatearFecha(c.validaHasta)}</span>
            ),
          },
          {
            key: "acciones",
            header: <span className="sr-only">Acciones</span>,
            className: "w-14 text-right",
            cell: acciones,
          },
        ]}
        renderMobile={(c) => (
          <div className="bg-card rounded-card flex items-start gap-2 py-3 pr-2 pl-4">
            <Link href={href(c)} className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-semibold">{c.codigo}</span>
                {estadoBadge(c)}
              </span>
              <span className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm">
                  {c.clienteNombre ?? <span className="text-muted">Sin cliente</span>}
                  <span className="text-muted"> · {ETIQUETA_TIPO_COTIZACION[c.tipo]}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {formatearPesos(c.total)}
                </span>
              </span>
              <span className="text-subtle text-xs">
                {formatearFecha(c.fecha)} · {c.vendedor} · válida hasta{" "}
                {formatearFecha(c.validaHasta)}
              </span>
            </Link>
            <div className="-mt-1 shrink-0">{acciones(c)}</div>
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
