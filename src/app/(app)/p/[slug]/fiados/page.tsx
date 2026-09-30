import { Modulo } from "@prisma/client";
import { HandCoins, MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { TelefonoWhatsApp } from "@/components/clientes/telefono-whatsapp";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { StatCard } from "@/components/ui/stat-card";
import { fechasDeRango, finDelDia, inicioDelDia } from "@/lib/fechas";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { formatearFecha } from "@/lib/utils";
import { linkWhatsApp, mostrarTelefono } from "@/lib/validations/cliente";
import { listarDeudoresSchema } from "@/lib/validations/fiado";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { deudores, resumenFiados, type Deudor } from "@/server/services/fiado.service";

export const metadata: Metadata = { title: "Fiados" };

type SP = Record<string, string | string[] | undefined>;

/** Más de 30 días debiendo: badge ámbar apagado. */
const DIAS_ALERTA = 30;

function Antiguedad({ d }: { d: Deudor }) {
  if (d.diasAntiguedad === null) return <span className="text-subtle">—</span>;
  const texto = d.diasAntiguedad === 0 ? "Hoy" : `${d.diasAntiguedad} días`;
  return d.diasAntiguedad > DIAS_ALERTA ? (
    <Badge variant="warning" title={`Desde el ${formatearFecha(d.fiadoMasViejo)}`}>
      {texto}
    </Badge>
  ) : (
    <span
      className="text-muted whitespace-nowrap"
      title={`Desde el ${formatearFecha(d.fiadoMasViejo)}`}
    >
      {texto}
    </span>
  );
}

/**
 * Fiados (FIADOS "ver"): lo que se debe en total, lo fiado y cobrado en el mes,
 * y los clientes con deuda (de mayor a menor). Cada uno abre su cuenta corriente.
 */
export default async function FiadosPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.FIADOS, "ver");
  const { slug } = ctx.panel;
  const params = await searchParams;
  const plano = Object.fromEntries(
    Object.entries(params).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const filtros = listarDeudoresSchema.parse(plano);
  const mes = fechasDeRango("mes");
  const [r, resumen] = await Promise.all([
    deudores(ctx, filtros),
    resumenFiados(ctx, {
      desde: inicioDelDia(mes.desde),
      hasta: new Date(finDelDia(mes.hasta).getTime() + 1),
    }),
  ]);
  const conFiltros = Boolean(filtros.q);
  const href = (d: Deudor) => rutaPanel(slug, `/fiados/${d.id}`);

  return (
    <>
      <PageHeader title="Fiados" subtitle="Cuenta corriente: quién debe, cuánto y desde cuándo" />
      <section
        aria-label="Resumen de fiados"
        className="mb-4 grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4"
      >
        <StatCard label="Por cobrar" value={formatearPesos(resumen.porCobrar)} />
        <StatCard label="Deudores" value={formatearNumero(resumen.deudores)} />
        <StatCard label="Fiado este mes" value={formatearPesos(resumen.fiadoPeriodo)} />
        <StatCard label="Cobrado este mes" value={formatearPesos(resumen.cobradoPeriodo)} />
      </section>
      <section aria-label="Buscar deudores" className="bg-card rounded-card mb-4 p-4">
        <SearchInput placeholder="Nombre o teléfono" />
      </section>
      <DataTable
        caption="Clientes que deben"
        rows={r.deudores}
        getRowKey={(d) => d.id}
        empty={
          conFiltros ? (
            <EmptyState
              icon={HandCoins}
              title={`No hay deudores con “${filtros.q}”`}
              action={
                <Link
                  href={rutaPanel(slug, "/fiados")}
                  className={buttonVariants({ variant: "secondary" })}
                >
                  Limpiar búsqueda
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={HandCoins}
              title="Nadie debe nada"
              description="Cuando una venta se cobra en parte, lo pendiente aparece acá."
            />
          )
        }
        columns={[
          {
            key: "nombre",
            header: "Cliente",
            cell: (d) => (
              <Link
                href={href(d)}
                className="text-foreground flex min-w-0 items-center gap-3 font-medium hover:underline"
              >
                <Avatar nombre={d.nombre} />
                <span className="truncate">{d.nombre}</span>
                {!d.activo && <Badge>Inactivo</Badge>}
              </Link>
            ),
          },
          {
            key: "telefono",
            header: "Teléfono",
            cell: (d) => <TelefonoWhatsApp telefono={d.telefono} className="text-muted" />,
          },
          {
            key: "ventas",
            header: "Ventas pendientes",
            className: "text-right tabular-nums",
            cell: (d) => d.ventasPendientes,
          },
          { key: "antiguedad", header: "Antigüedad", cell: (d) => <Antiguedad d={d} /> },
          {
            key: "saldo",
            header: "Debe",
            className: "text-right tabular-nums",
            cell: (d) => (
              <span className="font-semibold whitespace-nowrap">{formatearPesos(d.saldo)}</span>
            ),
          },
        ]}
        renderMobile={(d) => (
          <div className="bg-card rounded-card flex items-center gap-3 p-4">
            <Link href={href(d)} className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar nombre={d.nombre} className="size-10" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{d.nombre}</span>
                <span className="text-muted text-small block">
                  {d.ventasPendientes} venta{d.ventasPendientes === 1 ? "" : "s"} pendiente
                  {d.ventasPendientes === 1 ? "" : "s"}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-semibold tabular-nums">{formatearPesos(d.saldo)}</span>
                <Antiguedad d={d} />
              </span>
            </Link>
            <a
              href={linkWhatsApp(d.telefono)}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "secondary", size: "icon" })}
              aria-label={`WhatsApp a ${mostrarTelefono(d.telefono)}`}
            >
              <MessageCircle strokeWidth={1.75} aria-hidden />
            </a>
          </div>
        )}
      />
      <Pagination
        className="mt-4"
        page={r.page}
        pageSize={r.pageSize}
        total={r.total}
        pathname={rutaPanel(slug, "/fiados")}
        params={plano}
      />
    </>
  );
}
