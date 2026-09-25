"use client";

import { CheckCircle2, FileText, MessageCircle, Plus } from "lucide-react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import { linkWhatsApp, textoComprobante } from "@/lib/whatsapp";
import type { ClientePos } from "@/server/services/cliente.service";
import type { VentaConfirmada } from "@/server/services/venta.service";

/** Pantalla de éxito: nro, ticket, WhatsApp y "Nueva venta" (el foco va ahí para seguir cobrando). */
export function VentaExitosa({
  venta,
  vuelto,
  cliente,
  nombreNegocio,
  onNueva,
}: {
  venta: VentaConfirmada;
  vuelto: number;
  cliente: ClientePos | null;
  nombreNegocio: string;
  onNueva: () => void;
}) {
  const c = venta.comprobante;
  const numeroComprobante = c
    ? `Ticket ${String(c.puntoVenta).padStart(5, "0")}-${String(c.numero).padStart(8, "0")}`
    : null;
  const urlPdf =
    c?.pdfUrl && typeof window !== "undefined" ? `${window.location.origin}${c.pdfUrl}` : null;
  const whatsapp = linkWhatsApp(
    cliente?.telefono,
    textoComprobante({
      negocio: nombreNegocio,
      ventaNumero: venta.numero,
      total: formatearPesos(venta.total),
      comprobante: numeroComprobante,
      urlPdf,
      saldoPendiente:
        Number(venta.saldoPendiente) > 0 ? formatearPesos(venta.saldoPendiente) : null,
    }),
  );

  return (
    <section
      aria-label="Venta confirmada"
      className="mx-auto flex max-w-md flex-col items-center gap-4 py-6 text-center"
    >
      <CheckCircle2 className="text-success size-16" aria-hidden />
      <div>
        <h2 className="text-2xl font-bold">Venta #{venta.numero} confirmada</h2>
        <p className="text-muted">{numeroComprobante ?? "Sin comprobante"}</p>
      </div>
      <p className="text-4xl font-bold tabular-nums">{formatearPesos(venta.total)}</p>
      {vuelto > 0 && (
        <p className="bg-success-soft text-success-soft-foreground w-full rounded-xl px-4 py-3 text-xl font-semibold">
          Vuelto: <span className="tabular-nums">{formatearPesos(vuelto)}</span>
        </p>
      )}
      {Number(venta.saldoPendiente) > 0 && (
        <p className="bg-warning-soft text-warning-soft-foreground w-full rounded-xl px-4 py-3 font-medium">
          Quedó {formatearPesos(venta.saldoPendiente)} en la cuenta de {cliente?.nombre}
        </p>
      )}
      <div className="grid w-full grid-cols-2 gap-2">
        {c && (
          <a
            href={`/api/comprobantes/${c.id}/pdf`}
            target="_blank"
            rel="noopener"
            className={buttonVariants({ variant: "secondary" })}
          >
            <FileText /> Ver ticket
          </a>
        )}
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener"
          className={cn(buttonVariants({ variant: "secondary" }), !c && "col-span-2")}
        >
          <MessageCircle /> Enviar por WhatsApp
        </a>
        <Button size="lg" className="col-span-2" onClick={onNueva} autoFocus>
          <Plus /> Nueva venta
        </Button>
        <Link
          href={`/ventas/${venta.id}`}
          className="text-primary col-span-2 text-sm hover:underline"
        >
          Ver el detalle de la venta
        </Link>
      </div>
    </section>
  );
}
