import { Modulo } from "@prisma/client";
import { History, Info, RotateCcw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { esOwner, puede } from "@/lib/permisos";
import { cn, formatearFechaHora } from "@/lib/utils";
import { ESTADO_VENTA_UI, ETIQUETA_TIPO_VENTA, telefonoVisible } from "@/lib/ventas-ui";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { obtenerVenta } from "@/server/services/venta.service";

import { MedioPagoBadge } from "../_componentes/medio-pago";
import { AnularVenta } from "./acciones-venta";

export const metadata: Metadata = { title: "Venta" };

const ETIQUETA_MOVIMIENTO: Record<string, string> = {
  VENTA: "Venta",
  VENTA_ANULADA: "Anulación",
  DEVOLUCION_CLIENTE: "Anulación",
};

export default async function VentaPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePaginaPanel(Modulo.VENTAS, "ver");
  const { slug } = ctx.panel;
  const { id } = await params;
  const owner = esOwner(ctx.usuario);
  const v = await obtenerVenta(ctx, id, { verCostos: owner }).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const puedeHacer = (modulo: Modulo, accion: "ver" | "crear" = "ver") =>
    puede(ctx.usuario, ctx.panelId, modulo, accion);
  const confirmada = v.estado === "CONFIRMADA";
  const unidades = v.items.reduce((a, i) => a + i.cantidad, 0);

  const devolucionesBloquean = confirmada && owner && v.tieneDevolucionesRegistradas;

  return (
    <>
      <PageHeader
        title={`Venta ${v.codigo}`}
        className="[&_h1]:font-mono"
        breadcrumb={
          <Breadcrumb
            items={[{ label: "Ventas", href: rutaPanel(slug, "/ventas") }, { label: v.codigo }]}
          />
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={ESTADO_VENTA_UI[v.estado].variante}>
              {ESTADO_VENTA_UI[v.estado].label}
            </Badge>
            <span>{formatearFechaHora(v.fecha)}</span>
          </span>
        }
        actions={
          confirmada &&
          (puedeHacer(Modulo.DEVOLUCIONES, "crear") || owner) && (
            <>
              {puedeHacer(Modulo.DEVOLUCIONES, "crear") && (
                <Link
                  href={rutaPanel(slug, `/devoluciones?nueva=1&ventaId=${v.id}`)}
                  className={buttonVariants({ variant: "secondary" })}
                >
                  <RotateCcw strokeWidth={1.75} /> Devolución
                </Link>
              )}
              {owner && (
                <AnularVenta
                  venta={{ id: v.id, codigo: v.codigo, total: v.total }}
                  bloqueada={v.tieneDevolucionesRegistradas}
                />
              )}
            </>
          )
        }
      />

      <div className="flex flex-col gap-4">
        {v.anulacion && (
          <p className="bg-danger-soft text-danger-soft-foreground rounded-card px-4 py-3 text-sm">
            Anulada por {v.anulacion.por} el {formatearFechaHora(v.anulacion.at)}:{" "}
            {v.anulacion.motivo}
          </p>
        )}
        {devolucionesBloquean && (
          <p className="bg-card text-muted rounded-card flex items-start gap-2 px-4 py-3 text-sm">
            <Info className="mt-px size-5 shrink-0" strokeWidth={1.75} aria-hidden />
            Tiene devoluciones registradas: para anularla, primero anulá las devoluciones.
          </p>
        )}

        {/* Mobile: Ítems → Cliente y pago → Movimientos. Desktop: cliente y pago a la derecha. */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div className="contents">
            <SectionCard
              title="Ítems"
              className="min-w-0 lg:col-start-1"
              description={`${unidades} ${unidades === 1 ? "unidad" : "unidades"}`}
            >
              <ul
                aria-label="Ítems"
                className="divide-border border-border bg-surface rounded-card flex flex-col divide-y border"
              >
                {v.items.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-medium">{i.titulo}</p>
                      <p className="text-muted text-small tabular-nums">
                        {i.cantidad} ×{" "}
                        {i.esPrecioEspecial ? (
                          <>
                            <s className="text-subtle">{formatearPesos(i.precioLista)}</s>{" "}
                            <span className="text-foreground font-semibold">
                              {formatearPesos(i.precioUnitario)}
                            </span>{" "}
                            (precio especial)
                          </>
                        ) : (
                          formatearPesos(i.precioUnitario)
                        )}
                        {i.costoUnitario !== null && (
                          <> · costo {formatearPesos(i.costoUnitario)}</>
                        )}
                      </p>
                    </div>
                    <p className="font-semibold whitespace-nowrap tabular-nums">
                      {formatearPesos(i.subtotal)}
                    </p>
                  </li>
                ))}
                <li className="flex flex-col gap-1 px-4 py-3 text-sm">
                  {Number(v.descuento) > 0 && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted">Subtotal</span>
                        <span className="tabular-nums">{formatearPesos(v.subtotal)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted">Descuento</span>
                        <span className="tabular-nums">−{formatearPesos(v.descuento)}</span>
                      </div>
                    </>
                  )}
                  <div className="text-h3 flex justify-between font-semibold">
                    <span>Total</span>
                    <span
                      className={cn(
                        "tabular-nums",
                        v.estado === "ANULADA" && "text-muted line-through",
                      )}
                    >
                      {formatearPesos(v.total)}
                    </span>
                  </div>
                  {v.costoTotal !== null && v.gananciaBruta !== null && (
                    <div className="text-muted text-small flex justify-between gap-3">
                      <span>Costo {formatearPesos(v.costoTotal)}</span>
                      <span>Ganancia bruta {formatearPesos(v.gananciaBruta)}</span>
                    </div>
                  )}
                </li>
              </ul>
            </SectionCard>

            {v.movimientos.length > 0 && (
              <SectionCard
                title={<span id="movimientos-venta">Movimientos de stock</span>}
                className="min-w-0 max-lg:order-2 lg:col-start-1"
                action={
                  puedeHacer(Modulo.STOCK) && (
                    <Link
                      href={rutaPanel(
                        slug,
                        `/stock/movimientos?referenciaTipo=VENTA&referenciaId=${v.id}`,
                      )}
                      className={buttonVariants({ variant: "ghost", size: "sm" })}
                    >
                      <History strokeWidth={1.75} /> Ver en Stock
                    </Link>
                  )
                }
              >
                <ul className="divide-border border-border bg-surface rounded-card flex flex-col divide-y border text-sm">
                  {v.movimientos.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <span className="min-w-0">
                        <span className="block truncate">{m.titulo}</span>
                        <span className="text-muted text-xs">
                          {ETIQUETA_MOVIMIENTO[m.tipo] ?? m.tipo} · {m.deposito} ·{" "}
                          {formatearFechaHora(m.createdAt)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs tabular-nums">
                        <span className="text-foreground block text-sm font-semibold">
                          {m.tipo === "VENTA" ? "−" : "+"}
                          {m.cantidad}
                        </span>
                        <span className="text-subtle">
                          {m.stockAnterior} → {m.stockPosterior}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            )}

            {v.devoluciones.length > 0 && (
              <SectionCard
                title={<span id="devoluciones-venta">Devoluciones</span>}
                className="min-w-0 max-lg:order-2 lg:col-start-1"
              >
                <ul className="divide-border border-border bg-surface rounded-card flex flex-col divide-y border text-sm">
                  {v.devoluciones.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <Link
                        href={rutaPanel(slug, `/devoluciones/${d.id}`)}
                        className="text-foreground font-mono font-semibold hover:underline"
                      >
                        {d.codigo}
                      </Link>
                      <span className="text-muted flex items-center gap-2 text-xs">
                        {formatearFechaHora(d.fecha)}
                        {d.estado === "ANULADA" && <Badge>Anulada</Badge>}
                      </span>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            )}
          </div>

          <SectionCard
            title="Cliente y pago"
            className="max-lg:order-1 lg:col-start-2 lg:row-span-3 lg:row-start-1"
          >
            <dl className="flex flex-col gap-4 text-sm">
              <div className="flex items-center gap-3">
                <Avatar nombre={v.cliente.nombre} />
                <div className="min-w-0">
                  <dt className="sr-only">Cliente</dt>
                  <dd>
                    {puedeHacer(Modulo.CLIENTES) ? (
                      <Link
                        href={rutaPanel(slug, `/clientes/${v.cliente.id}`)}
                        className="text-foreground block truncate font-semibold hover:underline"
                      >
                        {v.cliente.nombre}
                      </Link>
                    ) : (
                      <p className="truncate font-semibold">{v.cliente.nombre}</p>
                    )}
                    <p className="text-muted tabular-nums">{telefonoVisible(v.cliente.telefono)}</p>
                  </dd>
                </div>
              </div>
              <div className="border-border grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 border-t pt-4">
                <dt className="text-muted">Medio de pago</dt>
                <dd className="text-right">
                  <MedioPagoBadge medio={v.medioPago} />
                </dd>
                <dt className="text-muted">Tipo</dt>
                <dd className="text-right">{ETIQUETA_TIPO_VENTA[v.tipo]}</dd>
                <dt className="text-muted">Vendedor</dt>
                <dd className="text-right">{v.vendedor.nombre}</dd>
                <dt className="text-muted">Galpón</dt>
                <dd className="text-right">{v.deposito.nombre}</dd>
                {v.notas && (
                  <>
                    <dt className="text-muted col-span-2">Notas</dt>
                    <dd className="col-span-2 whitespace-pre-line">{v.notas}</dd>
                  </>
                )}
              </div>
            </dl>
          </SectionCard>
        </div>
      </div>
    </>
  );
}
