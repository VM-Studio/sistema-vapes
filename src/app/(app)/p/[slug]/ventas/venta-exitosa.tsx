"use client";

import { CircleCheck, Copy, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useRutaPanel } from "@/components/layout/panel-context";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatearPesos } from "@/lib/format";
import {
  ETIQUETA_MEDIO_PAGO,
  etiquetaMedioPrincipal,
  linkWhatsAppVenta,
  telefonoVisible,
  textoResumenVenta,
} from "@/lib/ventas-ui";
import type { VentaGenerada } from "@/server/services/venta.service";

export function VentaExitosa({ venta }: { venta: VentaGenerada }) {
  const ruta = useRutaPanel();
  const [copiado, setCopiado] = useState(false);
  const whatsapp = linkWhatsAppVenta(
    venta.cliente.telefono,
    textoResumenVenta({
      codigo: venta.codigo,
      cliente: venta.cliente.nombre,
      items: venta.items,
      descuento: venta.descuento,
      total: venta.total,
      pagado: venta.montoPagado,
      pendiente: venta.saldoPendiente,
    }),
  );
  const debe = Number(venta.saldoPendiente) > 0;
  const medios =
    venta.pagos.length > 1
      ? venta.pagos.map((p) => ETIQUETA_MEDIO_PAGO[p.medioPago]).join(" + ")
      : etiquetaMedioPrincipal(venta.medioPago);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-6 py-4 text-center md:py-8">
      <span className="bg-success-soft rounded-circle flex size-14 items-center justify-center">
        <CircleCheck className="text-success size-7" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-muted text-small font-medium">ID de venta</p>
        <p className="text-display font-mono font-semibold" data-testid="id-venta">
          {venta.codigo}
        </p>
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="text-h1 font-semibold tabular-nums">{formatearPesos(venta.total)}</p>
        <p className="text-muted text-sm">
          {medios} · {venta.deposito.nombre}
        </p>
        {debe && (
          <p
            className="text-foreground text-sm font-medium tabular-nums"
            data-testid="pago-parcial"
          >
            Pagado {formatearPesos(venta.montoPagado)} · Pendiente{" "}
            {formatearPesos(venta.saldoPendiente)}
          </p>
        )}
      </div>
      <div className="bg-card rounded-card w-full p-4 text-left md:p-5">
        <p className="font-semibold">
          {venta.cliente.nombre}
          {venta.clienteNuevo && (
            <span className="text-muted text-sm font-normal"> · cliente nuevo</span>
          )}
        </p>
        <p className="text-muted text-sm tabular-nums">{telefonoVisible(venta.cliente.telefono)}</p>
        <ul className="border-border mt-3 flex flex-col gap-1 border-t pt-3 text-sm">
          {venta.items.map((i) => (
            <li key={i.varianteId} className="flex justify-between gap-3">
              <span>
                {i.cantidad} × {i.titulo}
              </span>
              <span className="shrink-0 tabular-nums">{formatearPesos(i.subtotal)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="grid w-full gap-2 sm:grid-cols-2">
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(venta.codigo);
              setCopiado(true);
              setTimeout(() => setCopiado(false), 1500);
            } catch {
              setCopiado(false);
            }
          }}
        >
          <Copy strokeWidth={1.75} /> {copiado ? "¡Copiado!" : "Copiar ID"}
        </Button>
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "secondary" })}
          data-testid="whatsapp-venta"
        >
          <MessageCircle strokeWidth={1.75} /> Enviar resumen por WhatsApp
        </a>
      </div>
      <Link
        href={ruta(`/ventas/${venta.id}`)}
        className="text-foreground text-sm font-medium underline-offset-4 hover:underline"
      >
        Ver el detalle de la venta
      </Link>
    </div>
  );
}
