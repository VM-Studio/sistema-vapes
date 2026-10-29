import { Contact, UserPlus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { StatCard } from "@/components/ui/stat-card";
import { formatearNumero } from "@/lib/format";
import { formatearFecha } from "@/lib/utils";
import { mostrarTelefono } from "@/lib/validations/cliente";
import type {
  ClienteCartera,
  FiltroCartera,
  ResumenCartera,
} from "@/server/services/cartera-clientes.service";

/** Normaliza ?filtro= de la URL. */
export function filtroCarteraDe(v: string | undefined): FiltroCartera {
  return v === "previos" || v === "nuevos" ? v : "todos";
}

/**
 * Cómo entró a la cartera: «Nuevo · VAP-000123» (se dio de alta con esa
 * venta, abre la venta si hay link) o «Ya lo tenía».
 */
export function OrigenCartera({
  c,
  hrefVenta,
}: {
  c: Pick<ClienteCartera, "ventaAlta">;
  hrefVenta: ((id: string) => string) | null;
}) {
  if (!c.ventaAlta) return <Badge variant="neutral">Ya lo tenía</Badge>;
  const texto = `Nuevo · ${c.ventaAlta.codigo}`;
  return hrefVenta ? (
    <Link
      href={hrefVenta(c.ventaAlta.id)}
      className="rounded-control inline-flex"
      title={`Se sumó con la venta ${c.ventaAlta.codigo} del ${formatearFecha(c.ventaAlta.fecha)}`}
    >
      <Badge variant="success" className="hover:underline">
        {texto}
      </Badge>
    </Link>
  ) : (
    <Badge variant="success">{texto}</Badge>
  );
}

/** Tarjetas: en cartera, ya los tenía, nuevos por ventas y nuevos del mes. */
export function TarjetasCartera({
  r,
  hrefFiltro,
  filtro,
}: {
  r: ResumenCartera;
  hrefFiltro: (f: FiltroCartera) => string;
  filtro: FiltroCartera;
}) {
  return (
    <section
      aria-label="Resumen de la cartera"
      className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4"
      data-testid="resumen-cartera"
    >
      <StatCard
        label="En la cartera"
        value={formatearNumero(r.total)}
        icono={Contact}
        href={hrefFiltro("todos")}
        activo={filtro === "todos"}
      />
      <StatCard
        label="Ya los tenía"
        value={formatearNumero(r.previos)}
        hint="Cargados antes de vender: no cuentan como nuevos"
        href={hrefFiltro("previos")}
        activo={filtro === "previos"}
      />
      <StatCard
        label="Nuevos por ventas"
        value={formatearNumero(r.nuevos)}
        icono={UserPlus}
        acento="oliva"
        href={hrefFiltro("nuevos")}
        activo={filtro === "nuevos"}
      />
      <StatCard label="Nuevos este mes" value={formatearNumero(r.nuevosDelMes)} icono={UserPlus} />
    </section>
  );
}

/**
 * Lista de la cartera de un vendedor (filtrada por las tarjetas de
 * TarjetasCartera; tabla en desktop y tarjetas en mobile, paginada). Sin estado: la usan
 * «Mis clientes» (el vendedor) y Equipo (los dueños, con otros links).
 */
export function ListaCartera({
  resultado,
  params,
  pathname,
  hrefCliente,
  hrefVenta,
  vacio,
}: {
  resultado: { clientes: ClienteCartera[]; total: number; page: number; pageSize: number };
  params: Record<string, string>;
  pathname: string;
  hrefCliente: (id: string) => string;
  hrefVenta: ((id: string) => string) | null;
  /** Estado vacío sin filtros. */
  vacio: ReactNode;
}) {
  const filtro = filtroCarteraDe(params.filtro);
  const conFiltros = Boolean(params.q) || filtro !== "todos";
  return (
    <>
      <DataTable
        caption="Clientes de la cartera"
        rows={resultado.clientes}
        getRowKey={(c) => c.id}
        empty={
          conFiltros ? (
            <EmptyState
              icon={Contact}
              title={params.q ? `Nadie coincide con “${params.q}”` : "No hay clientes acá todavía"}
            />
          ) : (
            vacio
          )
        }
        columns={[
          {
            key: "nombre",
            header: "Nombre",
            cell: (c) => (
              <Link
                href={hrefCliente(c.id)}
                className="text-foreground flex min-w-0 items-center gap-3 font-medium hover:underline"
              >
                <Avatar nombre={c.nombre} />
                <span className="truncate">{c.nombre}</span>
                {!c.activo && <Badge>Inactivo</Badge>}
              </Link>
            ),
          },
          {
            key: "telefono",
            header: "Teléfono",
            cell: (c) => (
              <span className="text-muted tabular-nums">{mostrarTelefono(c.telefono)}</span>
            ),
          },
          {
            key: "origen",
            header: "Origen",
            cell: (c) => <OrigenCartera c={c} hrefVenta={hrefVenta} />,
          },
          {
            key: "desde",
            header: "En la cartera desde",
            cell: (c) => <span className="text-muted">{formatearFecha(c.createdAt)}</span>,
          },
          {
            key: "compras",
            header: "Compras",
            className: "text-right tabular-nums",
            cell: (c) => c.compras,
          },
          {
            key: "ultima",
            header: "Última compra",
            cell: (c) => (
              <span className="text-muted whitespace-nowrap">{formatearFecha(c.ultimaCompra)}</span>
            ),
          },
        ]}
        renderMobile={(c) => (
          <div className="bg-card rounded-card flex flex-col gap-2 p-4">
            <Link href={hrefCliente(c.id)} className="flex min-w-0 items-center gap-3">
              <Avatar nombre={c.nombre} className="size-10" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.nombre}</span>
                <span className="text-muted text-small block tabular-nums">
                  {mostrarTelefono(c.telefono)}
                </span>
              </span>
            </Link>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <OrigenCartera c={c} hrefVenta={hrefVenta} />
              <span className="text-subtle text-xs">
                {c.compras} compra{c.compras === 1 ? "" : "s"}
                {c.ultimaCompra ? ` · última ${formatearFecha(c.ultimaCompra)}` : ""}
              </span>
            </div>
          </div>
        )}
      />
      <Pagination
        className="mt-4"
        page={resultado.page}
        pageSize={resultado.pageSize}
        total={resultado.total}
        pathname={pathname}
        params={params}
      />
    </>
  );
}
