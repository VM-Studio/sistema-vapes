import { EstadoTransferencia, Modulo } from "@prisma/client";
import { ArrowRight, ArrowLeftRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ChipLink, ChipRow } from "@/components/ui/chip";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { hrefCon, Pagination } from "@/components/ui/pagination";
import { ESTADO_TRANSFERENCIA_UI } from "@/lib/movimientos-ui";
import { rutaPanel } from "@/lib/paneles";
import { formatearFechaHora } from "@/lib/utils";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { depositosActivosPanel } from "@/server/services/inventario.service";
import {
  listarTransferencias,
  type TransferenciaListada,
} from "@/server/services/movimiento.service";

import { SelectorDeposito, StockTabs } from "../movimientos-tabs";

export const metadata: Metadata = { title: "Transferencias" };

type SP = Record<string, string | string[] | undefined>;

export default async function TransferenciasPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.STOCK, "ver");
  const PATH = rutaPanel(ctx.panel.slug, "/stock/movimientos/transferencias");
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

  const estadoBadge = (t: TransferenciaListada) => (
    <Badge variant={ESTADO_TRANSFERENCIA_UI[t.estado].variante}>
      {ESTADO_TRANSFERENCIA_UI[t.estado].label}
    </Badge>
  );
  const ruta = (t: TransferenciaListada) => (
    <span className="inline-flex items-center gap-1.5">
      {t.origen} <ArrowRight className="text-muted size-3.5" strokeWidth={1.75} aria-label="a" />{" "}
      {t.destino}
    </span>
  );

  return (
    <>
      <StockTabs panel={ctx.panel} actual="transferencias" depositoId={depositoId} />
      <PageHeader
        title="Transferencias"
        subtitle="Mercadería movida entre galpones. Para transferir, usá “Transferir” en la fila del sabor, en Stock."
      />
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
        empty={<EmptyState icon={ArrowLeftRight} title="No hay transferencias" />}
        columns={[
          {
            key: "numero",
            header: "N.º",
            cell: (t) => (
              <Link href={`${PATH}/${t.id}`} className="text-primary font-semibold hover:underline">
                #{t.numero}
              </Link>
            ),
          },
          {
            key: "fecha",
            header: "Fecha",
            cell: (t) => <span className="text-muted">{formatearFechaHora(t.fecha)}</span>,
          },
          { key: "ruta", header: "Origen → destino", cell: ruta },
          {
            key: "items",
            header: "Productos",
            className: "text-right tabular-nums",
            cell: (t) => `${t.items} (${t.unidades} u.)`,
          },
          { key: "estado", header: "Estado", cell: estadoBadge },
          { key: "usuario", header: "Creada por", cell: (t) => t.usuario },
        ]}
        renderMobile={(t) => (
          <Link
            href={`${PATH}/${t.id}`}
            className="border-border bg-surface block rounded-2xl border p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">#{t.numero}</span>
              {estadoBadge(t)}
            </div>
            <p className="mt-1 text-sm">{ruta(t)}</p>
            <p className="text-muted text-xs">
              {t.items} productos · {t.unidades} unidades · {formatearFechaHora(t.fecha)}
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
