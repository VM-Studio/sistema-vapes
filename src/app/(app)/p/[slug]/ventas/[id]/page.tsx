import { Modulo } from "@prisma/client";
import { ArrowLeft, History, RotateCcw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { esOwner, puede } from "@/lib/permisos";
import { cn, formatearFechaHora } from "@/lib/utils";
import {
  CLASE_MEDIO_PAGO,
  ESTADO_VENTA_UI,
  ETIQUETA_MEDIO_PAGO,
  ETIQUETA_TIPO_VENTA,
  telefonoVisible,
} from "@/lib/ventas-ui";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { obtenerVenta } from "@/server/services/venta.service";

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

  return (
    <>
      <PageHeader
        title={`Venta ${v.codigo}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={ESTADO_VENTA_UI[v.estado].variante}>
              {ESTADO_VENTA_UI[v.estado].label}
            </Badge>
            <span>{formatearFechaHora(v.fecha)}</span>
          </span>
        }
        actions={
          <Link
            href={rutaPanel(slug, "/ventas")}
            className={buttonVariants({ variant: "secondary" })}
          >
            <ArrowLeft strokeWidth={1.75} /> Ventas
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {v.anulacion && (
            <p className="bg-danger-soft text-danger-soft-foreground rounded-2xl px-4 py-3 text-sm">
              Anulada por {v.anulacion.por} el {formatearFechaHora(v.anulacion.at)}:{" "}
              {v.anulacion.motivo}
            </p>
          )}
          <Card>
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm md:grid-cols-3">
              <div>
                <p className="text-muted">Cliente</p>
                {puedeHacer(Modulo.CLIENTES) ? (
                  <Link
                    href={rutaPanel(slug, `/clientes/${v.cliente.id}`)}
                    className="text-primary font-medium hover:underline"
                  >
                    {v.cliente.nombre}
                  </Link>
                ) : (
                  <p className="font-medium">{v.cliente.nombre}</p>
                )}
                <p className="text-muted tabular-nums">{telefonoVisible(v.cliente.telefono)}</p>
              </div>
              <div>
                <p className="text-muted">Vendedor</p>
                <p>{v.vendedor.nombre}</p>
              </div>
              <div>
                <p className="text-muted">Galpón</p>
                <p>{v.deposito.nombre}</p>
              </div>
              <div>
                <p className="text-muted">Medio de pago</p>
                <span
                  className={cn(
                    "mt-0.5 inline-flex rounded-[var(--radius-control)] px-2.5 py-1 text-xs font-medium",
                    CLASE_MEDIO_PAGO[v.medioPago],
                  )}
                >
                  {ETIQUETA_MEDIO_PAGO[v.medioPago]}
                </span>
              </div>
              <div>
                <p className="text-muted">Tipo</p>
                <p>{ETIQUETA_TIPO_VENTA[v.tipo]}</p>
              </div>
              {v.notas && (
                <div className="col-span-2 md:col-span-3">
                  <p className="text-muted">Notas</p>
                  <p className="whitespace-pre-line">{v.notas}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <ul
            aria-label="Ítems"
            className="divide-border border-border bg-surface flex flex-col divide-y rounded-2xl border"
          >
            {v.items.map((i) => (
              <li key={i.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{i.titulo}</p>
                  <p className="text-muted text-xs tabular-nums">
                    {i.cantidad} ×{" "}
                    {i.esPrecioEspecial ? (
                      <>
                        <s>{formatearPesos(i.precioLista)}</s>{" "}
                        <span className="text-primary font-semibold">
                          {formatearPesos(i.precioUnitario)}
                        </span>{" "}
                        (precio especial)
                      </>
                    ) : (
                      formatearPesos(i.precioUnitario)
                    )}
                    {i.costoUnitario !== null && <> · costo {formatearPesos(i.costoUnitario)}</>}
                  </p>
                </div>
                <p className="font-semibold tabular-nums">{formatearPesos(i.subtotal)}</p>
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
              <div className="flex justify-between text-base font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatearPesos(v.total)}</span>
              </div>
              {v.costoTotal !== null && v.gananciaBruta !== null && (
                <div className="text-muted flex justify-between text-xs">
                  <span>Costo {formatearPesos(v.costoTotal)}</span>
                  <span>Ganancia bruta {formatearPesos(v.gananciaBruta)}</span>
                </div>
              )}
            </li>
          </ul>

          {v.movimientos.length > 0 && (
            <section aria-labelledby="movimientos-venta" className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <h2 id="movimientos-venta" className="font-semibold">
                  Movimientos de stock
                </h2>
                {puedeHacer(Modulo.STOCK) && (
                  <Link
                    href={rutaPanel(
                      slug,
                      `/stock/movimientos?referenciaTipo=VENTA&referenciaId=${v.id}`,
                    )}
                    className="text-primary inline-flex items-center gap-1.5 text-sm hover:underline"
                  >
                    <History className="size-4" strokeWidth={1.75} aria-hidden /> Ver en Stock
                  </Link>
                )}
              </div>
              <ul className="divide-border border-border bg-surface flex flex-col divide-y rounded-2xl border text-sm">
                {v.movimientos.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate">{m.titulo}</span>
                      <span className="text-muted text-xs">
                        {ETIQUETA_MOVIMIENTO[m.tipo] ?? m.tipo} · {m.deposito} ·{" "}
                        {formatearFechaHora(m.createdAt)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-xs tabular-nums">
                      <span
                        className={cn(
                          "block text-sm font-semibold",
                          m.tipo === "VENTA" ? "text-danger" : "text-success",
                        )}
                      >
                        {m.tipo === "VENTA" ? "−" : "+"}
                        {m.cantidad}
                      </span>
                      <span className="text-muted">
                        {m.stockAnterior} → {m.stockPosterior}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {v.devoluciones.length > 0 && (
            <section aria-labelledby="devoluciones-venta" className="flex flex-col gap-2">
              <h2 id="devoluciones-venta" className="font-semibold">
                Devoluciones
              </h2>
              <ul className="divide-border border-border bg-surface flex flex-col divide-y rounded-2xl border text-sm">
                {v.devoluciones.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <Link
                      href={rutaPanel(slug, `/devoluciones/${d.id}`)}
                      className="text-primary font-medium tabular-nums hover:underline"
                    >
                      {d.codigo}
                    </Link>
                    <span className="text-muted text-xs">
                      {formatearFechaHora(d.fecha)}
                      {d.estado === "ANULADA" && " · anulada"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {confirmada && puedeHacer(Modulo.DEVOLUCIONES, "crear") && (
            <Link
              href={rutaPanel(slug, `/devoluciones?nueva=1&ventaId=${v.id}`)}
              className={buttonVariants({ variant: "secondary" })}
            >
              <RotateCcw strokeWidth={1.75} /> Registrar devolución de esta venta
            </Link>
          )}
          {confirmada && owner && (
            <AnularVenta
              venta={{ id: v.id, codigo: v.codigo, total: v.total }}
              bloqueada={v.tieneDevolucionesRegistradas}
            />
          )}
        </div>
      </div>
    </>
  );
}
