import { ChevronRight, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SelectorPeriodo } from "@/components/analitica/selector-periodo";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { MenuFila } from "@/components/ui/menu-fila";
import { StatCard } from "@/components/ui/stat-card";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { cn } from "@/lib/utils";
import { requirePaginaPanelOwner } from "@/server/auth/permissions";
import {
  describirPeriodo,
  diaDe,
  periodoDesdeParams,
  queryPeriodo,
  rendimientoVendedores,
  type RendimientoVendedor,
} from "@/server/services/analitica.service";

export const metadata: Metadata = { title: "Equipo" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Índice del equipo (solo dueños): una fila por vendedor del período, con link a su detalle. */
export default async function EquipoPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePaginaPanelOwner();
  const sp = await searchParams;
  const periodo = periodoDesdeParams(sp);
  const desc = describirPeriodo(periodo);
  const filas = await rendimientoVendedores(ctx, periodo);
  const qs = queryPeriodo(sp);
  const detalle = (r: RendimientoVendedor) =>
    `${rutaPanel(ctx.panel.slug, `/equipo/${r.usuarioId}`)}${qs}`;

  const suma = (f: (r: RendimientoVendedor) => number) => filas.reduce((a, r) => a + f(r), 0);
  const conComision = filas.some((r) => r.comision);

  const columnas = [
    {
      key: "vendedor",
      header: "Vendedor",
      cell: (r: RendimientoVendedor) => (
        <Link href={detalle(r)} className="group flex items-center gap-3">
          <Avatar nombre={r.nombre} />
          <span className="font-medium group-hover:underline">{r.nombre}</span>
          <Badge variant={r.rol === "OWNER" ? "primary" : "neutral"}>
            {r.rol === "OWNER" ? "Dueño" : "Empleado"}
          </Badge>
        </Link>
      ),
    },
    {
      key: "ventas",
      header: "Ventas",
      className: "text-right",
      cell: (r: RendimientoVendedor) => formatearNumero(r.cantidadVentas),
    },
    {
      key: "unidades",
      header: "Unidades",
      className: "text-right",
      cell: (r: RendimientoVendedor) => formatearNumero(r.unidades),
    },
    {
      key: "facturado",
      header: "Facturado",
      className: "text-right font-semibold",
      cell: (r: RendimientoVendedor) => formatearPesos(r.facturado),
    },
    {
      key: "comision",
      header: "Comisión estimada",
      className: "text-right",
      cell: (r: RendimientoVendedor) => (r.comision ? formatearPesos(r.comision.estimada) : "—"),
    },
    {
      key: "acciones",
      header: <span className="sr-only">Acciones</span>,
      className: "w-12 text-right",
      cell: (r: RendimientoVendedor) => (
        <MenuFila
          label={`Acciones de ${r.nombre}`}
          acciones={[{ label: "Ver detalle", href: detalle(r) }]}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="mb-2 flex flex-col gap-4 md:mb-4 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="flex min-w-0 flex-col gap-1 md:pt-1">
          <h1 className="text-h1 font-semibold">Equipo</h1>
          <p className="text-muted text-body">Rendimiento de cada vendedor en el período.</p>
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
      </header>

      {filas.length === 0 ? (
        <EmptyState icon={Users} title="Sin ventas en el período" />
      ) : (
        <>
          <section
            aria-label="Totales del equipo"
            className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4"
          >
            <StatCard label="Facturado" value={formatearPesos(suma((r) => Number(r.facturado)))} />
            <StatCard label="Ventas" value={formatearNumero(suma((r) => r.cantidadVentas))} />
            <StatCard label="Unidades" value={formatearNumero(suma((r) => r.unidades))} />
            <StatCard
              label="Comisiones estimadas"
              value={
                conComision ? formatearPesos(suma((r) => Number(r.comision?.estimada ?? 0))) : "—"
              }
              hint="Orientativas"
            />
          </section>

          <DataTable
            className="mt-4"
            columns={columnas}
            rows={filas}
            getRowKey={(r) => r.usuarioId}
            caption="Vendedores"
            renderMobile={(r) => (
              <Link
                href={detalle(r)}
                className={cn(
                  cardVariants({ variant: "clickable" }),
                  "flex min-h-11 items-center gap-3 p-4",
                )}
              >
                <Avatar nombre={r.nombre} className="size-10" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{r.nombre}</span>
                    <Badge variant={r.rol === "OWNER" ? "primary" : "neutral"}>
                      {r.rol === "OWNER" ? "Dueño" : "Empleado"}
                    </Badge>
                  </div>
                  <p className="text-muted text-small tabular-nums">
                    {formatearNumero(r.cantidadVentas)}{" "}
                    {r.cantidadVentas === 1 ? "venta" : "ventas"} · {formatearNumero(r.unidades)} u.
                    {r.comision ? ` · comisión ${formatearPesos(r.comision.estimada)}` : ""}
                  </p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums">
                  {formatearPesos(r.facturado)}
                </span>
                <ChevronRight
                  className="text-subtle size-5 shrink-0"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </Link>
            )}
          />
        </>
      )}
    </div>
  );
}
