import { Modulo } from "@prisma/client";
import { ArrowLeft, FileText, History, MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { formatearPesos } from "@/lib/format";
import { esOwner, puede } from "@/lib/permisos";
import { cn, formatearFechaHora } from "@/lib/utils";
import { ESTADO_PAGO_UI, ESTADO_VENTA_UI } from "@/lib/ventas-ui";
import { urlCompartible } from "@/server/storage";
import { requirePaginaPermiso } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import {
  ETIQUETA_COMPROBANTE,
  numeroComprobante,
  obtenerPdfComprobante,
} from "@/server/services/comprobante.service";
import { obtenerConfigVentas } from "@/server/services/configuracion.service";
import { listarDepositosActivos } from "@/server/services/deposito.service";
import { obtenerVenta } from "@/server/services/venta.service";

import { VentasTabs } from "../ventas-tabs";
import { AccionesVenta, AnularPagoBoton, WhatsAppComprobante } from "./acciones-venta";

export const metadata: Metadata = { title: "Venta" };

export default async function VentaPage({ params }: { params: Promise<{ id: string }> }) {
  const usuario = await requirePaginaPermiso(Modulo.VENTAS, "ver");
  const { id } = await params;
  const v = await obtenerVenta(id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [depositos, config] = await Promise.all([listarDepositosActivos(), obtenerConfigVentas()]);
  // El link de WhatsApp necesita la URL pública del ticket: si todavía no se generó, se genera ahora.
  const referenciaPdf =
    v.comprobante?.estado === "EMITIDO"
      ? (v.comprobante.pdfUrl ??
        (await obtenerPdfComprobante(v.comprobante.id).catch(() => null))?.url ??
        null)
      : null;
  // Para WhatsApp: con R2, URL firmada de 7 días; en local, la de la app.
  const pdfUrl = referenciaPdf ? await urlCompartible(referenciaPdf) : null;
  const owner = esOwner(usuario);
  const confirmada = v.estado === "CONFIRMADA";
  const devueltas = v.items.reduce((a, i) => a + i.cantidadDevuelta, 0);
  const comprobante = v.comprobante
    ? `${ETIQUETA_COMPROBANTE[v.comprobante.tipo]} ${numeroComprobante(v.comprobante.puntoVenta, v.comprobante.numero)}`
    : null;

  return (
    <>
      <VentasTabs usuario={usuario} actual="listado" />
      <PageHeader
        title={`Venta #${v.numero}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={ESTADO_VENTA_UI[v.estado].variante}>
              {ESTADO_VENTA_UI[v.estado].label}
            </Badge>
            {confirmada && (
              <Badge variant={ESTADO_PAGO_UI[v.estadoPago].variante}>
                {ESTADO_PAGO_UI[v.estadoPago].label}
              </Badge>
            )}
            {v.cliente ? (
              <Link href={`/clientes/${v.cliente.id}`} className="text-primary hover:underline">
                {v.cliente.nombre}
              </Link>
            ) : (
              "Consumidor final"
            )}
          </span>
        }
        actions={
          <Link href="/ventas" className={buttonVariants({ variant: "secondary" })}>
            <ArrowLeft /> Ventas
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {v.anulacion && (
            <p className="bg-danger-soft text-danger-soft-foreground rounded-xl px-4 py-3 text-sm">
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
                <p className="text-muted">Comprobante</p>
                <p>{comprobante ?? "—"}</p>
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
            className="divide-border border-border bg-surface flex flex-col divide-y rounded-xl border"
          >
            {v.items.map((i) => (
              <li key={i.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{i.nombre}</p>
                  <p className="text-muted text-xs">
                    {i.cantidad} × {formatearPesos(i.precioUnitario)}
                    {owner && <> · costo {formatearPesos(i.costoUnitario)}</>}
                    {i.cantidadDevuelta > 0 && (
                      <span className="text-warning-soft-foreground font-semibold">
                        {" "}
                        · devueltas {i.cantidadDevuelta}
                      </span>
                    )}
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
              {owner && (
                <div className="text-muted flex justify-between text-xs">
                  <span>Costo {formatearPesos(v.costoTotal)}</span>
                  <span>Ganancia bruta {formatearPesos(v.gananciaBruta)}</span>
                </div>
              )}
            </li>
          </ul>

          {v.devoluciones.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Devoluciones</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-3 text-sm">
                  {v.devoluciones.map((d) => (
                    <li key={d.id} className="border-border rounded-lg border p-3">
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">Devolución #{d.numero}</span>
                        <span className="font-semibold tabular-nums">
                          {formatearPesos(d.total)}
                        </span>
                      </div>
                      <p className="text-muted text-xs">
                        {formatearFechaHora(d.fecha)} · {d.usuario} · a {d.deposito}
                      </p>
                      <p className="text-xs">
                        {d.items.map((i) => `${i.cantidad} × ${i.nombre}`).join(", ")}
                      </p>
                      <p className="text-xs">
                        {Number(d.reintegroMonto) > 0 &&
                          `Reintegro: ${formatearPesos(d.reintegroMonto)} (${d.reintegroMedioPago?.toLowerCase()})`}
                        {Number(d.aCuentaCorriente) > 0 &&
                          `A la cuenta del cliente: ${formatearPesos(d.aCuentaCorriente)}`}
                      </p>
                      <p className="text-muted text-xs">Motivo: {d.motivo}</p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Pagos</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {v.pagos.length === 0 && <p className="text-muted">Sin pagos.</p>}
              {v.pagos.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    "flex items-start justify-between gap-2",
                    p.anulado && "opacity-60",
                  )}
                >
                  <div className="min-w-0">
                    <p className={cn("font-medium", p.anulado && "line-through")}>
                      {p.etiqueta}
                      {p.referencia && (
                        <span className="text-muted font-normal"> · {p.referencia}</span>
                      )}
                    </p>
                    <p className="text-muted text-xs">
                      {formatearFechaHora(p.fecha)} · {p.usuario}
                      {p.anulacion && ` · anulado por ${p.anulacion.por}: ${p.anulacion.motivo}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className={cn("font-semibold tabular-nums", p.anulado && "line-through")}>
                      {formatearPesos(p.monto)}
                    </span>
                    {owner && confirmada && !p.anulado && (
                      <AnularPagoBoton
                        pagoId={p.id}
                        descripcion={`${p.etiqueta} ${formatearPesos(p.monto)}`}
                      />
                    )}
                  </div>
                </div>
              ))}
              {confirmada && (
                <div className="border-border mt-1 flex flex-col gap-1 border-t pt-2">
                  <div className="flex justify-between">
                    <span className="text-muted">Pagado</span>
                    <span className="tabular-nums">{formatearPesos(v.montoPagado)}</span>
                  </div>
                  <div
                    className={cn(
                      "flex justify-between font-semibold",
                      Number(v.saldoPendiente) > 0 && "text-danger",
                    )}
                  >
                    <span>Saldo pendiente</span>
                    <span className="tabular-nums">{formatearPesos(v.saldoPendiente)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {v.comprobante && (
            <Card>
              <CardHeader>
                <CardTitle>
                  Comprobante{" "}
                  {v.comprobante.estado === "ANULADO" && <Badge variant="danger">Anulado</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2">
                <a
                  href={`/api/comprobantes/${v.comprobante.id}/pdf`}
                  target="_blank"
                  rel="noopener"
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                >
                  <FileText /> Ticket
                </a>
                <a
                  href={`/api/comprobantes/${v.comprobante.id}/pdf?formato=a4&descargar=1`}
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                >
                  <FileText /> A4
                </a>
                {v.comprobante.estado === "EMITIDO" && (
                  <WhatsAppComprobante
                    className="col-span-2"
                    pdfUrl={pdfUrl}
                    telefono={v.cliente?.telefono ?? null}
                    negocio={config.nombreNegocio}
                    ventaNumero={v.numero}
                    total={formatearPesos(v.total)}
                    comprobante={comprobante}
                    saldoPendiente={
                      Number(v.saldoPendiente) > 0 ? formatearPesos(v.saldoPendiente) : null
                    }
                  >
                    <MessageCircle /> Reenviar por WhatsApp
                  </WhatsAppComprobante>
                )}
              </CardContent>
            </Card>
          )}

          {v.movimientos > 0 && puede(usuario, Modulo.MOVIMIENTOS, "ver") && (
            <Link
              href={`/movimientos?referenciaTipo=VENTA&referenciaId=${v.id}`}
              className={buttonVariants({
                variant: "ghost",
                className: "text-primary h-auto min-h-11 self-start py-2 whitespace-normal",
              })}
            >
              <History /> Ver los movimientos de stock{devueltas > 0 && " de la venta"}
            </Link>
          )}

          {confirmada && (
            <AccionesVenta
              venta={{
                id: v.id,
                numero: v.numero,
                saldoPendiente: v.saldoPendiente,
                montoPagado: v.montoPagado,
                tieneDevoluciones: v.devoluciones.length > 0,
                cliente: v.cliente
                  ? { nombre: v.cliente.nombre, saldoAFavor: v.cliente.saldoAFavor }
                  : null,
                depositoId: v.deposito.id,
                items: v.items.map((i) => ({
                  id: i.id,
                  nombre: i.nombre,
                  cantidad: i.cantidad,
                  cantidadDevuelta: i.cantidadDevuelta,
                })),
              }}
              depositos={depositos}
              puedeCobrar={puede(usuario, Modulo.VENTAS, "editar")}
              puedeDevolver={puede(usuario, Modulo.VENTAS, "editar")}
              puedeAnular={puede(usuario, Modulo.VENTAS, "eliminar")}
            />
          )}
        </div>
      </div>
    </>
  );
}
