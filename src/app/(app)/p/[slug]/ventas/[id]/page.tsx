import { Modulo } from "@prisma/client";
import { ArrowLeft, History } from "lucide-react";
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
import { formatearFechaHora } from "@/lib/utils";
import { ESTADO_VENTA_UI, ETIQUETA_MEDIO_PAGO } from "@/lib/ventas-ui";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { obtenerVenta } from "@/server/services/venta.service";

import { VentasTabs } from "../ventas-tabs";
import { AnularVenta } from "./acciones-venta";

export const metadata: Metadata = { title: "Venta" };

export default async function VentaPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePaginaPanel(Modulo.VENTAS, "ver");
  const { slug } = ctx.panel;
  const { id } = await params;
  const v = await obtenerVenta(ctx, id, { verCostos: esOwner(ctx.usuario) }).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const puedeVer = (modulo: Modulo, accion: "ver" | "eliminar" = "ver") =>
    puede(ctx.usuario, ctx.panelId, modulo, accion);
  const confirmada = v.estado === "CONFIRMADA";

  return (
    <>
      <VentasTabs ctx={ctx} actual="listado" />
      <PageHeader
        title={`Venta ${v.idVenta}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={ESTADO_VENTA_UI[v.estado].variante}>
              {ESTADO_VENTA_UI[v.estado].label}
            </Badge>
            {v.cliente ? (
              puedeVer(Modulo.CLIENTES) ? (
                <Link
                  href={rutaPanel(slug, `/clientes/${v.cliente.id}`)}
                  className="text-primary hover:underline"
                >
                  {v.cliente.nombre}
                </Link>
              ) : (
                v.cliente.nombre
              )
            ) : (
              "Consumidor final"
            )}
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
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
              <div>
                <p className="text-muted">Fecha</p>
                <p>{formatearFechaHora(v.fecha)}</p>
              </div>
              <div>
                <p className="text-muted">Vendedor</p>
                <p>{v.vendedor}</p>
              </div>
              <div>
                <p className="text-muted">Depósito</p>
                <p>{v.deposito.nombre}</p>
              </div>
              <div>
                <p className="text-muted">Medio de pago</p>
                <p>{v.medioPago ? ETIQUETA_MEDIO_PAGO[v.medioPago] : "—"}</p>
              </div>
              {v.notas && (
                <div className="col-span-2 md:col-span-4">
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
                  <p className="font-medium">{i.nombre}</p>
                  <p className="text-muted text-xs">
                    {i.cantidad} × {formatearPesos(i.precioUnitario)}
                    {i.costoUnitario !== null && <> · costo {formatearPesos(i.costoUnitario)}</>}
                  </p>
                  {i.notas && <p className="text-warning-soft-foreground text-xs">{i.notas}</p>}
                </div>
                <p className="font-semibold tabular-nums">{formatearPesos(i.subtotal)}</p>
              </li>
            ))}
            <li className="flex flex-col gap-1 px-4 py-3 text-sm">
              {(Number(v.descuento) > 0 || Number(v.redondeo) !== 0) && (
                <div className="flex justify-between">
                  <span className="text-muted">Subtotal</span>
                  <span className="tabular-nums">{formatearPesos(v.subtotal)}</span>
                </div>
              )}
              {Number(v.descuento) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted">Descuento</span>
                  <span className="tabular-nums">−{formatearPesos(v.descuento)}</span>
                </div>
              )}
              {Number(v.redondeo) !== 0 && (
                <div className="flex justify-between">
                  <span className="text-muted">Redondeo</span>
                  <span className="tabular-nums">{formatearPesos(v.redondeo)}</span>
                </div>
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
        </div>

        <div className="flex flex-col gap-2">
          {v.movimientos > 0 && puedeVer(Modulo.STOCK) && (
            <Link
              href={rutaPanel(slug, `/stock/movimientos?referenciaTipo=VENTA&referenciaId=${v.id}`)}
              className={buttonVariants({
                variant: "ghost",
                className: "text-primary h-auto min-h-11 self-start py-2 whitespace-normal",
              })}
            >
              <History strokeWidth={1.75} /> Ver los movimientos de stock
            </Link>
          )}
          {confirmada && !v.tieneDevoluciones && puedeVer(Modulo.VENTAS, "eliminar") && (
            <AnularVenta venta={{ id: v.id, idVenta: v.idVenta, total: v.total }} />
          )}
        </div>
      </div>
    </>
  );
}
