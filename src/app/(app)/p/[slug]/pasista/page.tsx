import { EstadoComisionPasista, Modulo } from "@prisma/client";
import { Download, PackageCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { ChipLink, ChipRow } from "@/components/ui/chip";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { hrefCon, Pagination } from "@/components/ui/pagination";
import { StatCard } from "@/components/ui/stat-card";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { esOwner } from "@/lib/permisos";
import { formatearFecha } from "@/lib/utils";
import { filtrosPasistaSchema } from "@/lib/validations/pasista";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { nombreMes } from "@/server/reportes/filtros";
import {
  listar,
  mesActualAR,
  totalesPasista,
  type ComisionListada,
} from "@/server/services/pasista.service";

import { SelectorMes } from "../reportes/resumen-mensual/selector-mes";
import { DeshacerPago, MarcarPagado } from "./acciones-pasista";

export const metadata: Metadata = { title: "Pasista" };

type SP = Record<string, string | string[] | undefined>;

function EstadoBadge({ c }: { c: ComisionListada }) {
  return c.estado === EstadoComisionPasista.PAGADA ? (
    <Badge variant="success">Pagada</Badge>
  ) : (
    <Badge variant="warning">Pendiente</Badge>
  );
}

/**
 * PASISTA ("ver"): comisión del pasista de cada compra con tick, por mes.
 * Pendiente total, devengado y pagado del mes, la lista y el total a pagar.
 * Los dueños marcan el mes (o una compra) como pagado y deshacen pagos.
 */
export default async function PasistaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.PASISTA, "ver");
  const { slug } = ctx.panel;
  const PATH = rutaPanel(slug, "/pasista");
  const plano = Object.fromEntries(
    Object.entries(await searchParams).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const f = filtrosPasistaSchema.parse(plano);
  const hoy = mesActualAR();
  const mes = f.mes ?? hoy;
  const [r, t] = await Promise.all([
    listar(ctx, { mes, estado: f.estado, page: f.page, pageSize: f.pageSize }),
    totalesPasista(ctx, mes),
  ]);
  const owner = esOwner(ctx.usuario);
  const nombre = nombreMes(mes);
  const delMesActual = mes === hoy;
  const detalle = (c: ComisionListada) => `${PATH}/${c.id}`;
  const pendientesMes = Number(t.pendienteMes);

  return (
    <>
      <PageHeader
        title="Pasista"
        subtitle="Comisión del pasista por cada compra, acumulada por mes."
        actions={
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/p/${slug}/pasista/exportar?mes=${mes}`}
              className={buttonVariants({ variant: "secondary" })}
            >
              <Download strokeWidth={1.75} /> Excel del mes
            </a>
            {owner && pendientesMes > 0 && (
              <MarcarPagado
                objetivo={{ mes }}
                titulo={`Marcar ${nombre} como pagado`}
                resumen={`Se marcan pagadas todas las comisiones pendientes de ${nombre}: ${formatearPesos(t.pendienteMes)}.`}
                textoBoton="Marcar mes como pagado"
              />
            )}
          </div>
        }
      />
      <section
        aria-label="Resumen del pasista"
        className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3 md:gap-4"
      >
        <StatCard
          label="Pendiente de pago"
          value={formatearPesos(t.pendienteTotal)}
          hint="Todos los meses"
          acento="naranja"
        />
        <StatCard
          label={delMesActual ? "Devengado este mes" : `Devengado en ${nombre}`}
          value={formatearPesos(t.devengadoMes)}
          hint={`${formatearNumero(t.comprasMes)} ${t.comprasMes === 1 ? "compra" : "compras"}`}
          acento="azul"
        />
        <StatCard
          label={delMesActual ? "Pagado este mes" : `Pagado en ${nombre}`}
          value={formatearPesos(t.pagadoMes)}
          acento="oliva"
        />
      </section>
      <div className="bg-card rounded-card mb-4 flex flex-col gap-3 p-4 md:flex-row md:items-end md:justify-between">
        <SelectorMes mes={mes} max={hoy} />
        <ChipRow ariaLabel="Estado">
          <ChipLink href={hrefCon(PATH, plano, { estado: null, page: null })} activo={!f.estado}>
            Todas
          </ChipLink>
          <ChipLink
            href={hrefCon(PATH, plano, { estado: "PENDIENTE", page: null })}
            activo={f.estado === "PENDIENTE"}
          >
            Pendientes
          </ChipLink>
          <ChipLink
            href={hrefCon(PATH, plano, { estado: "PAGADA", page: null })}
            activo={f.estado === "PAGADA"}
          >
            Pagadas
          </ChipLink>
        </ChipRow>
      </div>
      <DataTable
        caption={`Comisiones de ${nombre}`}
        rows={r.filas}
        getRowKey={(c) => c.id}
        empty={
          <EmptyState
            icon={PackageCheck}
            title={`No hay comisiones del pasista en ${nombre}`}
            description="Aparecen cuando una compra tiene tildada la comisión del pasista."
          />
        }
        columns={[
          {
            key: "compra",
            header: "Compra",
            cell: (c) => (
              <span className="flex flex-col">
                <Link
                  href={detalle(c)}
                  className="font-mono font-semibold underline-offset-4 hover:underline"
                >
                  {c.compra}
                </Link>
                {c.tipo === "AJUSTE" && <span className="text-subtle text-xs">Ajuste</span>}
                {c.estadoCompra === "ANULADA" && (
                  <span className="text-subtle text-xs">Compra anulada</span>
                )}
              </span>
            ),
          },
          {
            key: "fecha",
            header: "Fecha",
            cell: (c) => (
              <span className="text-muted whitespace-nowrap">{formatearFecha(c.fecha)}</span>
            ),
          },
          {
            key: "proveedor",
            header: "Proveedor",
            cell: (c) => c.proveedor ?? <span className="text-subtle">—</span>,
          },
          {
            key: "unidades",
            header: "Unidades",
            className: "text-right tabular-nums",
            cell: (c) => formatearNumero(c.unidades),
          },
          {
            key: "base",
            header: "Base",
            className: "text-right tabular-nums",
            cell: (c) => formatearPesos(c.base),
          },
          {
            key: "pct",
            header: "%",
            className: "text-right tabular-nums",
            cell: (c) => (c.porcentaje ? `${formatearNumero(Number(c.porcentaje))}%` : "—"),
          },
          {
            key: "monto",
            header: "Comisión",
            className: "text-right tabular-nums font-semibold",
            cell: (c) => formatearPesos(c.monto),
          },
          { key: "estado", header: "Estado", cell: (c) => <EstadoBadge c={c} /> },
          ...(owner
            ? [
                {
                  key: "acciones",
                  header: <span className="sr-only">Acciones</span>,
                  className: "text-right",
                  ocultarEnMobile: true,
                  cell: (c: ComisionListada) =>
                    c.estado === "PENDIENTE" ? (
                      <MarcarPagado
                        objetivo={{ ids: [c.id] }}
                        titulo={`Marcar pagada la comisión de ${c.compra}`}
                        resumen={formatearPesos(c.monto)}
                        textoBoton="Marcar pagada"
                        variante="secondary"
                        size="sm"
                      />
                    ) : (
                      <DeshacerPago id={c.id} etiqueta={c.compra} />
                    ),
                },
              ]
            : []),
        ]}
        renderMobile={(c) => (
          <div className="flex flex-col gap-2">
            <Link
              href={detalle(c)}
              className={cardVariants({
                variant: "clickable",
                className: "flex flex-col gap-2 p-4",
              })}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-semibold">
                  {c.compra}
                  {c.tipo === "AJUSTE" && (
                    <span className="text-subtle ml-2 font-sans text-xs">Ajuste</span>
                  )}
                </span>
                <EstadoBadge c={c} />
              </div>
              <p className="truncate font-medium">{c.proveedor ?? "Sin proveedor"}</p>
              <div className="flex items-end justify-between gap-2">
                <p className="text-muted text-small">
                  {formatearFecha(c.fecha)} · {formatearNumero(c.unidades)} u. ·{" "}
                  {formatearPesos(c.base)}
                  {c.porcentaje ? ` × ${formatearNumero(Number(c.porcentaje))}%` : ""}
                </p>
                <p className="shrink-0 font-semibold tabular-nums">{formatearPesos(c.monto)}</p>
              </div>
            </Link>
            {owner && (
              <div className="self-end">
                {c.estado === "PENDIENTE" ? (
                  <MarcarPagado
                    objetivo={{ ids: [c.id] }}
                    titulo={`Marcar pagada la comisión de ${c.compra}`}
                    resumen={formatearPesos(c.monto)}
                    textoBoton="Marcar pagada"
                    variante="secondary"
                    size="sm"
                  />
                ) : (
                  <DeshacerPago id={c.id} etiqueta={c.compra} />
                )}
              </div>
            )}
          </div>
        )}
      />
      <Pagination
        className="mt-4"
        page={r.page}
        pageSize={r.pageSize}
        total={r.total}
        pathname={PATH}
        params={plano}
      />
      <p
        className="bg-card rounded-card mt-4 flex flex-wrap items-baseline justify-between gap-2 p-4"
        aria-label="Total a pagar del mes"
      >
        <span className="font-semibold">Total a pagar al pasista en {nombre}</span>
        <strong className="text-h2 tabular-nums">{formatearPesos(t.pendienteMes)}</strong>
      </p>
    </>
  );
}
