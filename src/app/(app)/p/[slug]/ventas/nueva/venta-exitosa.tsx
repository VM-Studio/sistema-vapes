"use client";

import { CheckCircle2, Plus } from "lucide-react";
import Link from "next/link";

import { useRutaPanel } from "@/components/layout/panel-context";
import { Button } from "@/components/ui/button";
import { formatearPesos } from "@/lib/format";
import { ETIQUETA_MEDIO_PAGO } from "@/lib/ventas-ui";
import type { ClientePos } from "@/server/services/cliente.service";
import type { VentaConfirmada } from "@/server/services/venta.service";

/** Pantalla de éxito: ID de venta, total, vuelto y "Nueva venta" (el foco va ahí para seguir cobrando). */
export function VentaExitosa({
  venta,
  vuelto,
  cliente,
  onNueva,
}: {
  venta: VentaConfirmada;
  vuelto: number;
  cliente: ClientePos | null;
  onNueva: () => void;
}) {
  const ruta = useRutaPanel();
  return (
    <section
      aria-label="Venta confirmada"
      className="mx-auto flex max-w-md flex-col items-center gap-4 py-6 text-center"
    >
      <CheckCircle2 className="text-success size-16" strokeWidth={1.75} aria-hidden />
      <div>
        <p className="text-muted text-sm">Venta confirmada</p>
        <h2 className="text-3xl font-bold tracking-tight tabular-nums" data-testid="id-venta">
          {venta.idVenta}
        </h2>
        <p className="text-muted text-sm">
          {ETIQUETA_MEDIO_PAGO[venta.medioPago]}
          {cliente && ` · ${cliente.nombre}`}
        </p>
      </div>
      <p className="text-4xl font-bold tabular-nums">{formatearPesos(venta.total)}</p>
      {vuelto > 0 && (
        <p className="bg-success-soft text-success-soft-foreground w-full rounded-2xl px-4 py-3 text-xl font-semibold">
          Vuelto: <span className="tabular-nums">{formatearPesos(vuelto)}</span>
        </p>
      )}
      <div className="flex w-full flex-col gap-2">
        <Button size="lg" fullWidth onClick={onNueva} autoFocus>
          <Plus strokeWidth={1.75} /> Nueva venta
        </Button>
        <Link
          href={ruta(`/ventas/${venta.id}`)}
          className="text-primary inline-flex min-h-11 items-center justify-center text-sm hover:underline"
        >
          Ver el detalle de la venta
        </Link>
      </div>
    </section>
  );
}
