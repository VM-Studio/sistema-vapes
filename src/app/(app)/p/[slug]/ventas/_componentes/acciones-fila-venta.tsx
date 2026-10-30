"use client";

import { Ban, Eye } from "lucide-react";
import { useState } from "react";

import { MenuFila, type AccionFila } from "@/components/ui/menu-fila";

import { DialogoAnularVenta, type VentaAnulable } from "../[id]/acciones-venta";

/**
 * Menú «…» de una venta en el listado: «Ver» y, con permiso para anular (dueños
 * o VENTAS "eliminar") y la venta confirmada, «Anular» con confirmación.
 */
export function AccionesFilaVenta({
  venta,
  href,
  anulable,
}: {
  venta: VentaAnulable;
  href: string;
  anulable: boolean;
}) {
  const [anulando, setAnulando] = useState(false);
  const acciones: AccionFila[] = [
    { label: "Ver", icon: Eye, href },
    ...(anulable
      ? [{ label: "Anular venta", icon: Ban, peligro: true, onSelect: () => setAnulando(true) }]
      : []),
  ];
  return (
    <>
      <MenuFila acciones={acciones} label={`Acciones de ${venta.codigo}`} />
      {anulable && <DialogoAnularVenta venta={venta} open={anulando} onOpenChange={setAnulando} />}
    </>
  );
}
