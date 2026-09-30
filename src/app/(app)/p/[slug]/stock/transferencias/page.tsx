import { EstadoTransferencia, Modulo } from "@prisma/client";
import { ArrowLeftRight, ArrowRight, FileText, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { ChipLink, ChipRow } from "@/components/ui/chip";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { hrefCon, Pagination } from "@/components/ui/pagination";
import { formatearNumero } from "@/lib/format";
import { ESTADO_TRANSFERENCIA_UI } from "@/lib/movimientos-ui";
import { rutaPanel } from "@/lib/paneles";
import { puede } from "@/lib/permisos";
import { formatearFechaHora } from "@/lib/utils";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { depositosActivosPanel } from "@/server/services/inventario.service";
import {
  listarTransferencias,
  type TransferenciaListada,
} from "@/server/services/transferencia.service";

import { SelectorDeposito, StockTabs } from "../movimientos/movimientos-tabs";

export const metadata: Metadata = { title: "Transferencias" };

type SP = Record<string, string | string[] | undefined>;

/** Transferencias entre galpones: listado filtrable y acceso a "Nueva transferencia". */
export default async function TransferenciasPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.STOCK, "ver");
  const PATH = rutaPanel(ctx.panel.slug, "/stock/transferencias");
  const params = await searchParams;
  const plano = Object.fromEntries(
    Object.entries(params).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const estado = Object.values(EstadoTransferencia).includes(plano.estado as EstadoTransferencia)
    ? (plano.estado as EstadoTransferencia)
    : undefined;
  const page = Math.max(1, Number(plano.page) || 1);
  const depositos = await depositosActivosPanel(ctx);
  const depositoId = depositos.find((d) => d.id === plano.depositoId)?.id;
  const r = await listarTransferencias(ctx, { estado, depositoId, page, pageSize: 30 });
  const puedeCrear = puede(ctx.usuario, ctx.panelId, Modulo.STOCK, "crear") && depositos.length > 1;

  const estadoBadge = (t: TransferenciaListada) => (
    <Badge variant={ESTADO_TRANSFERENCIA_UI[t.estado].variante}>
      {ESTADO_TRANSFERENCIA_UI[t.estado].label}
    </Badge>
  );
  const recorrido = (t: TransferenciaListada) => (
    <span className="inline-flex items-center gap-1.5">
      {t.origen} <ArrowRight className="text-muted size-4" strokeWidth={1.75} aria-label="a" />{" "}
      {t.destino}
    </span>
  );
  const remito = (t: TransferenciaListada) =>
    t.remitoUrl ? (
      <a
        href={t.remitoUrl}
        target="_blank"
        rel="noreferrer"
        className={buttonVariants({ variant: "ghost", size: "sm" })}
        aria-label={`Remito de ${t.codigo} (PDF)`}
      >
        <FileText strokeWidth={1.75} /> PDF
      </a>
    ) : (
      <span className="text-subtle">—</span>
    );
  const nueva = (
    <Link href={`${PATH}/nueva`} className={buttonVariants()}>
      <Plus strokeWidth={1.75} /> Nueva transferencia
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Transferencias"
        subtitle="Mercadería movida entre galpones, con su remito."
        breadcrumb={
          <Breadcrumb
            items={[
              { label: "Stock", href: rutaPanel(ctx.panel.slug, "/stock") },
              { label: "Transferencias" },
            ]}
          />
        }
        actions={puedeCrear ? nueva : undefined}
      />
      <StockTabs panel={ctx.panel} actual="transferencias" depositoId={depositoId} />
      <SelectorDeposito
        depositos={depositos}
        actual={depositoId}
        pathname={PATH}
        params={plano}
        className="mb-2"
      />
      <ChipRow className="mb-4" ariaLabel="Estado">
        <ChipLink href={hrefCon(PATH, plano, { estado: null, page: null })} activo={!estado}>
          Todas
        </ChipLink>
        {Object.values(EstadoTransferencia).map((e) => (
          <ChipLink
            key={e}
            href={hrefCon(PATH, plano, { estado: e, page: null })}
            activo={estado === e}
          >
            {ESTADO_TRANSFERENCIA_UI[e].label}
          </ChipLink>
        ))}
      </ChipRow>
      <DataTable
        caption="Transferencias"
        rows={r.transferencias}
        getRowKey={(t) => t.id}
        empty={
          estado || depositoId ? (
            <EmptyState
              icon={ArrowLeftRight}
              title="No hay transferencias con esos filtros"
              description="Probá con otro galpón o estado."
              action={
                <Link href={PATH} className={buttonVariants({ variant: "secondary" })}>
                  Limpiar filtros
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={ArrowLeftRight}
              title="Todavía no hay transferencias"
              description="Escaneá la mercadería que sale de un galpón y queda registrada con su remito."
              action={puedeCrear ? nueva : null}
            />
          )
        }
        columns={[
          {
            key: "codigo",
            header: "Código",
            cell: (t) => (
              <Link
                href={`${PATH}/${t.id}`}
                className="font-mono font-semibold underline-offset-4 hover:underline"
              >
                {t.codigo}
              </Link>
            ),
          },
          {
            key: "fecha",
            header: "Fecha",
            cell: (t) => <span className="text-muted">{formatearFechaHora(t.fecha)}</span>,
          },
          { key: "ruta", header: "Origen → destino", cell: recorrido },
          {
            key: "unidades",
            header: "Unidades",
            className: "text-right tabular-nums",
            cell: (t) => formatearNumero(t.unidades),
          },
          { key: "estado", header: "Estado", cell: estadoBadge },
          { key: "usuario", header: "Usuario", cell: (t) => t.usuario },
          { key: "remito", header: "Remito", cell: remito },
        ]}
        renderMobile={(t) => (
          <Link
            href={`${PATH}/${t.id}`}
            className={cardVariants({ variant: "clickable", className: "flex flex-col gap-1 p-4" })}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono font-semibold">{t.codigo}</span>
              {estadoBadge(t)}
            </div>
            <p className="font-medium">{recorrido(t)}</p>
            <p className="text-muted text-small">
              {formatearNumero(t.unidades)} unidades · {t.usuario} · {formatearFechaHora(t.fecha)}
            </p>
          </Link>
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
    </>
  );
}
