import { Modulo } from "@prisma/client";
import { HandCoins, Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { TelefonoWhatsApp } from "@/components/clientes/telefono-whatsapp";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { esOwner, puede } from "@/lib/permisos";
import { cn, formatearFecha, formatearFechaHora } from "@/lib/utils";
import { ESTADO_PAGO_UI, ETIQUETA_MEDIO_PAGO } from "@/lib/ventas-ui";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { cuentaCorriente, type MovimientoCC } from "@/server/services/fiado.service";

import { AnularCobro, RegistrarCobro } from "./acciones-fiado";

export const metadata: Metadata = { title: "Cuenta corriente" };

/**
 * Cuenta corriente de un cliente (FIADOS "ver"): ventas fiadas y cobros con el
 * saldo acumulado, y las ventas que todavía deben. Registrar cobro: FIADOS
 * "editar"; anular un cobro: solo dueños.
 */
export default async function CuentaCorrientePage({
  params,
}: {
  params: Promise<{ clienteId: string }>;
}) {
  const ctx = await requirePaginaPanel(Modulo.FIADOS, "ver");
  const { slug } = ctx.panel;
  const { clienteId } = await params;
  const cc = await cuentaCorriente(ctx, clienteId).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { cliente: c } = cc;
  const owner = esOwner(ctx.usuario);
  const puedeCobrar = puede(ctx.usuario, ctx.panelId, Modulo.FIADOS, "editar");
  const verVentas = puede(ctx.usuario, ctx.panelId, Modulo.VENTAS, "ver");
  const verCliente = puede(ctx.usuario, ctx.panelId, Modulo.CLIENTES, "ver");
  const masVieja = cc.pendientes[0];
  const movimientos = [...cc.movimientos].reverse();

  const codigoVenta = (ventaId: string, codigo: string) =>
    verVentas ? (
      <Link
        href={rutaPanel(slug, `/ventas/${ventaId}`)}
        className="text-foreground font-mono font-semibold hover:underline"
      >
        {codigo}
      </Link>
    ) : (
      <span className="font-mono font-semibold">{codigo}</span>
    );

  const detalle = (m: MovimientoCC) =>
    m.tipo === "VENTA" ? (
      <span className="flex flex-col">
        <span>Venta {codigoVenta(m.ventaId, m.codigo)}</span>
        <span className="text-muted text-xs">
          Total {formatearPesos(m.total)}
          {Number(m.pagadoAlVender) > 0 && ` · pagó ${formatearPesos(m.pagadoAlVender)} al comprar`}
        </span>
      </span>
    ) : (
      <span className={cn("flex flex-col", m.anulado && "text-muted")}>
        <span className="flex flex-wrap items-center gap-2">
          <span className={cn(m.anulado && "line-through")}>
            Cobro · {ETIQUETA_MEDIO_PAGO[m.medioPago]}
          </span>
          {m.anulado && <Badge>Anulado</Badge>}
        </span>
        <span className="text-muted text-xs">
          {m.imputaciones.map((i) => `${i.codigo} ${formatearPesos(i.monto)}`).join(" · ")}
          {m.referencia && ` · Ref. ${m.referencia}`}
          {` · ${m.usuario}`}
          {m.anulado && m.motivoAnulacion && ` · ${m.motivoAnulacion}`}
        </span>
      </span>
    );

  return (
    <>
      <PageHeader
        title={c.nombre}
        breadcrumb={
          <Breadcrumb
            items={[{ label: "Fiados", href: rutaPanel(slug, "/fiados") }, { label: c.nombre }]}
          />
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <TelefonoWhatsApp telefono={c.telefono} />
            {!c.activo && <Badge>Inactivo</Badge>}
            {verCliente && (
              <Link
                href={rutaPanel(slug, `/clientes/${c.id}`)}
                className="text-foreground font-medium underline-offset-4 hover:underline"
              >
                Ver ficha del cliente
              </Link>
            )}
          </span>
        }
        actions={
          // Sin deuda el botón queda deshabilitado (montado: después de cobrar todo, el
          // Sheet sigue abierto con el recibo aunque la página se refresque).
          puedeCobrar && (
            <RegistrarCobro
              cliente={{ id: c.id, nombre: c.nombre, telefono: c.telefono }}
              saldo={c.saldo}
              pendientes={cc.pendientes}
            />
          )
        }
      />
      <section
        aria-label="Resumen de la cuenta"
        className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4"
      >
        <StatCard label="Debe" value={formatearPesos(c.saldo)} />
        <StatCard label="Ventas pendientes" value={String(cc.pendientes.length)} />
        <StatCard
          label="Fiado más viejo"
          value={masVieja ? `${masVieja.diasAntiguedad} días` : "—"}
          hint={masVieja ? `Desde el ${formatearFecha(masVieja.fecha)}` : undefined}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
        <SectionCard
          title="Cuenta corriente"
          description="Ventas fiadas y cobros, del más reciente al más viejo"
        >
          <DataTable
            caption="Movimientos de la cuenta corriente"
            rows={movimientos}
            getRowKey={(m) => (m.tipo === "VENTA" ? `v${m.ventaId}` : `c${m.cobroId}`)}
            empty={
              <EmptyState
                icon={Receipt}
                title="Sin movimientos"
                description="Este cliente nunca compró fiado."
                className="bg-surface py-10 md:py-12"
              />
            }
            columns={[
              {
                key: "fecha",
                header: "Fecha",
                cell: (m) => (
                  <span className="text-muted whitespace-nowrap">
                    {formatearFechaHora(m.fecha)}
                  </span>
                ),
              },
              { key: "detalle", header: "Movimiento", cell: detalle },
              {
                key: "debe",
                header: "Debe",
                className: "text-right tabular-nums",
                cell: (m) => (m.tipo === "VENTA" ? formatearPesos(m.importe) : ""),
              },
              {
                key: "pago",
                header: "Pagó",
                className: "text-right tabular-nums",
                cell: (m) =>
                  m.tipo === "COBRO" ? (
                    <span className={cn(m.anulado && "text-muted line-through")}>
                      {formatearPesos(m.importe)}
                    </span>
                  ) : (
                    ""
                  ),
              },
              {
                key: "saldo",
                header: "Saldo",
                className: "text-right tabular-nums",
                cell: (m) => (
                  <span className="font-semibold whitespace-nowrap">
                    {formatearPesos(m.saldoAcumulado)}
                  </span>
                ),
              },
              ...(owner
                ? [
                    {
                      key: "acciones",
                      header: <span className="sr-only">Acciones</span>,
                      className: "text-right",
                      cell: (m: MovimientoCC) =>
                        m.tipo === "COBRO" && !m.anulado ? (
                          <AnularCobro pagoId={m.pagoId} monto={m.importe} />
                        ) : null,
                    },
                  ]
                : []),
            ]}
            renderMobile={(m) => (
              <div className="border-border bg-surface rounded-card flex flex-col gap-1 border p-4">
                <div className="flex items-start justify-between gap-3 text-sm">
                  {detalle(m)}
                  <span
                    className={cn(
                      "shrink-0 font-semibold tabular-nums",
                      m.tipo === "COBRO" && m.anulado && "text-muted line-through",
                    )}
                  >
                    {m.tipo === "VENTA" ? "+" : "−"}
                    {formatearPesos(m.importe)}
                  </span>
                </div>
                <div className="text-muted flex items-center justify-between gap-3 text-xs">
                  <span>{formatearFechaHora(m.fecha)}</span>
                  <span className="tabular-nums">Saldo {formatearPesos(m.saldoAcumulado)}</span>
                </div>
                {owner && m.tipo === "COBRO" && !m.anulado && (
                  <div className="-mb-2 flex justify-end">
                    <AnularCobro pagoId={m.pagoId} monto={m.importe} />
                  </div>
                )}
              </div>
            )}
          />
        </SectionCard>

        <SectionCard
          title="Ventas pendientes"
          description="Los cobros se imputan de la más vieja a la más nueva"
        >
          {cc.pendientes.length === 0 ? (
            <EmptyState
              icon={HandCoins}
              title="Al día"
              description="No debe ninguna venta."
              className="bg-surface py-8"
            />
          ) : (
            <ul className="divide-border flex flex-col divide-y" data-testid="ventas-pendientes">
              {cc.pendientes.map((v) => (
                <li key={v.id} className="flex items-start justify-between gap-3 py-3 text-sm">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    {codigoVenta(v.id, v.codigo)}
                    <span className="text-muted text-xs">
                      {formatearFecha(v.fecha)} · total {formatearPesos(v.total)}
                      {Number(v.montoPagado) > 0 && ` · pagó ${formatearPesos(v.montoPagado)}`}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-semibold tabular-nums">
                      {formatearPesos(v.saldoPendiente)}
                    </span>
                    <Badge variant={v.diasAntiguedad > 30 ? "warning" : "neutral"}>
                      {ESTADO_PAGO_UI[v.estadoPago].label} · {v.diasAntiguedad} d
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </>
  );
}
