import { EstadoCompra, Modulo } from "@prisma/client";
import { Plus, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ChipLink, ChipRow } from "@/components/ui/chip";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { hrefCon, Pagination } from "@/components/ui/pagination";
import { formatearPesos } from "@/lib/format";
import { ESTADO_COMPRA_UI } from "@/lib/movimientos-ui";
import { rutaPanel } from "@/lib/paneles";
import { puede } from "@/lib/permisos";
import { formatearFechaHora } from "@/lib/utils";
import { listarComprasSchema } from "@/lib/validations/compra";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { listarCompras, type CompraListada } from "@/server/services/compra.service";
import { listarProveedoresActivos } from "@/server/services/proveedor.service";

import { FiltrosCompras } from "./filtros-compras";

export const metadata: Metadata = { title: "Compras" };

type SP = Record<string, string | string[] | undefined>;

export default async function ComprasPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.COMPRAS, "ver");
  const PATH = rutaPanel(ctx.panel.slug, "/compras");
  const plano = Object.fromEntries(
    Object.entries(await searchParams).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const filtros = listarComprasSchema.parse(plano);
  const [r, proveedores] = await Promise.all([
    listarCompras(ctx, filtros),
    listarProveedoresActivos(ctx),
  ]);

  const estadoBadge = (c: CompraListada) => (
    <Badge variant={ESTADO_COMPRA_UI[c.estado].variante}>{ESTADO_COMPRA_UI[c.estado].label}</Badge>
  );

  return (
    <>
      <PageHeader
        title="Compras"
        subtitle="Mercadería recibida de proveedores. El stock entra al recibir la compra."
        actions={
          puede(ctx.usuario, ctx.panelId, Modulo.COMPRAS, "crear") && (
            <Link href={`${PATH}/nueva`} className={buttonVariants()}>
              <Plus /> Nueva compra
            </Link>
          )
        }
      />
      <div className="mb-4 flex flex-col gap-3">
        <ChipRow ariaLabel="Estado">
          <ChipLink
            href={hrefCon(PATH, plano, { estado: null, page: null })}
            activo={!filtros.estado}
          >
            Todas
          </ChipLink>
          {Object.values(EstadoCompra).map((e) => (
            <ChipLink
              key={e}
              href={hrefCon(PATH, plano, { estado: e, page: null })}
              activo={filtros.estado === e}
            >
              {ESTADO_COMPRA_UI[e].label}
            </ChipLink>
          ))}
        </ChipRow>
        <FiltrosCompras params={plano} proveedores={proveedores} />
      </div>
      <DataTable
        caption="Compras"
        rows={r.compras}
        getRowKey={(c) => c.id}
        empty={
          <EmptyState
            icon={Truck}
            title="No hay compras"
            description="Registrá la mercadería que llega escaneándola en «Nueva compra»."
          />
        }
        columns={[
          {
            key: "numero",
            header: "N.º",
            cell: (c) => (
              <Link href={`${PATH}/${c.id}`} className="text-primary font-semibold hover:underline">
                #{c.numero}
              </Link>
            ),
          },
          {
            key: "fecha",
            header: "Fecha",
            cell: (c) => <span className="text-muted">{formatearFechaHora(c.fecha)}</span>,
          },
          {
            key: "proveedor",
            header: "Proveedor",
            cell: (c) => c.proveedor ?? <span className="text-muted">—</span>,
          },
          { key: "deposito", header: "Depósito", cell: (c) => c.deposito },
          {
            key: "items",
            header: "Productos",
            className: "text-right tabular-nums",
            cell: (c) => `${c.items} (${c.unidades} u.)`,
          },
          {
            key: "total",
            header: "Total",
            className: "text-right tabular-nums font-medium",
            cell: (c) => formatearPesos(c.total),
          },
          { key: "estado", header: "Estado", cell: estadoBadge },
        ]}
        renderMobile={(c) => (
          <Link
            href={`${PATH}/${c.id}`}
            className="border-border bg-surface block rounded-2xl border p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">
                #{c.numero} · {c.proveedor ?? "Sin proveedor"}
              </span>
              {estadoBadge(c)}
            </div>
            <div className="mt-1 flex items-end justify-between gap-2">
              <p className="text-muted text-xs">
                {c.deposito} · {c.unidades} u. · {formatearFechaHora(c.fecha)}
              </p>
              <p className="font-semibold tabular-nums">{formatearPesos(c.total)}</p>
            </div>
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
